import { app } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import { log } from '../../main/logger';
import { paths } from '../config/paths';
import { getMainWindow } from '../../main/window';
import { getSettings } from '../config/settings-manager';
import { getAuthState, getMinecraftAccessToken } from '../auth/microsoft-auth';
import { getProfile, recordPlaySession } from '../profiles/profile-manager';
import { setGamePresence, clearGamePresence } from '../discord/rich-presence';
import { loaderLabel } from '../../shared/labels';
import { syncManifest } from '../mods/mod-sync';
import { ensureJavaVersion, resolveChosenJava } from '../java/java-manager';
import { installLoader, isLoaderInstalled } from '../modloader/loader-manager';
import { resolveLaunchMeta } from '../modloader/loader-profile';
import { getVersionMeta } from './version-manifest';
import { ensureClientJar, ensureLibraries, ensureAssets } from './asset-downloader';
import { beginJob, endJob, isCancellation, throwIfCancelled } from '../util/cancellation';
import { machineMemoryMb } from '../util/machine-memory';
import { formatRamGb, ramAdvice, recommendedRamMb } from '../../shared/memory';
import {
  isShutdownWatchdogCrash,
  readMinecraftCrash,
  writeCrashReport,
} from '../diagnostics/crash-report';

import type { LaunchOptions, GameLogLine, GameExitInfo, Profile } from '../../shared/ipc-types';
import { customResolution, resolveConditionalArgs, substituteVars } from './launch-args';
import { requiredJavaFor } from './java-requirement';
import { applyFullscreen } from './options-file';
import { LaunchRefusedError } from './launch-errors';

// Track running processes by profileId
const runningProcesses = new Map<string, ChildProcess>();

// Per-profile log ring buffer (last 500 lines)
const logBuffers = new Map<string, string[]>();

function pushLog(profileId: string, line: string): void {
  const buf = logBuffers.get(profileId) ?? [];
  buf.push(line);
  if (buf.length > 500) buf.shift();
  logBuffers.set(profileId, buf);
}

function clearBuffer(profileId: string): void {
  logBuffers.delete(profileId);
}

export function getLogTail(profileId: string, n = 100): string[] {
  const buf = logBuffers.get(profileId) ?? [];
  return buf.slice(-n);
}

/**
 * The severity Minecraft itself put on a log line.
 *
 * Matched on the bracketed level the game's log format actually emits — the
 * usual shape is `[15:04:22] [Render thread/ERROR] [minecraft/…]` — rather than
 * on the line merely containing the word somewhere. Substring matching made an
 * error out of every mod whose name contains "error", every class path with
 * `ErrorHandler` in it, and the phrase "no errors found"; the log filter reads
 * this, so a startup that went perfectly showed as full of failures.
 */
const LOG_LEVEL_PATTERN = /\[[^\]]*\/(FATAL|ERROR|WARN|INFO|DEBUG|TRACE)\]|\[(ERROR|WARN|INFO)\]/i;

export function detectLogLevel(line: string): GameLogLine['level'] {
  const match = LOG_LEVEL_PATTERN.exec(line);
  const level = (match?.[1] ?? match?.[2])?.toUpperCase();
  if (level === 'ERROR' || level === 'FATAL') return 'error';
  if (level === 'WARN') return 'warn';
  return 'info';
}

function emitLogLine(profileId: string, rawLine: string): void {
  const trimmed = rawLine.trimEnd();
  pushLog(profileId, trimmed);

  const level = detectLogLevel(trimmed);

  const line: GameLogLine = {
    timestamp: new Date().toISOString(),
    level,
    message: trimmed,
  };

  getMainWindow()?.webContents.send('game:log', profileId, line);
}

// ── Argument building ──────────────────────────────────────

/**
 * Launcher features the version meta may gate arguments on. Anything absent
 * counts as false, which is what keeps unsupported modes switched off.
 *
 * Quick play stays off on purpose: this launcher does quick-connect the legacy
 * way, appending `--server`/`--port` below, and never writes the quick-play log
 * file that `--quickPlayPath` expects.
 */
function launchFeatures(profile: Profile): Record<string, boolean> {
  return {
    is_demo_user: false,
    has_custom_resolution: customResolution(profile.windowWidth, profile.windowHeight) !== null,
    has_quick_plays_support: false,
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: false,
    is_quick_play_realms: false,
  };
}

// ── Game launcher ──────────────────────────────────────────

/**
 * Run the prepare phase and spawn the game.
 *
 * Wrapped by `launchGame` so the job registration is torn down on every exit
 * path — a throw between `beginJob` and the spawn would otherwise leave a dead
 * controller behind, and the UI would keep offering to cancel nothing.
 */
/**
 * Refuse a `-Xmx` the machine cannot back, before anything is downloaded.
 *
 * A heap larger than physical memory is not a configuration that runs: on
 * Windows the JVM will not even reserve it and dies with "Could not reserve
 * enough space for object heap"; on Linux it starts and the OOM killer collects
 * the game once it grows in. Both arrive minutes and several gigabytes of
 * downloads later, as a crash with nothing in it about RAM — and a profile can
 * carry a number this machine never agreed to, having come from an import, a
 * pack, or a machine with twice the memory. So it is checked here, first, and
 * named.
 *
 * Only the impossible is refused. Merely optimistic — more than the machine can
 * comfortably spare — is the profile editor's warning to make and the player's
 * to overrule; a launcher that argued with every ambitious setting would be
 * wrong more often than it was right.
 */
function assertRamFits(profile: Profile): void {
  const totalMb = machineMemoryMb();
  if (ramAdvice(profile.allocatedRamMb, totalMb) !== 'over') return;
  const allocated = formatRamGb(profile.allocatedRamMb);
  const total = formatRamGb(totalMb);
  const recommended = formatRamGb(recommendedRamMb(totalMb));
  throw new LaunchRefusedError(
    { key: 'launchError.ramTooBig', vars: { allocated, total, recommended } },
    `This profile allocates ${allocated} of RAM and this machine has ${total}. Minecraft cannot ` +
      `start with more memory than the machine has — lower it in the profile editor, where ` +
      `${recommended} suits this one.`,
  );
}

async function runLaunch(options: LaunchOptions): Promise<void> {
  const profile = await getProfile(options.profileId);
  if (!profile) throw new Error(`Profile ${options.profileId} not found`);

  if (runningProcesses.has(options.profileId)) {
    throw new LaunchRefusedError(
      { key: 'launchError.alreadyRunning' },
      'Game is already running for this profile',
    );
  }

  assertRamFits(profile);

  log.info(`Launching game for profile: ${profile.name} (MC ${profile.minecraftVersion})`);

  // A profile that follows a pack is brought up to the pack before it starts.
  // Nothing else in this path touches mods — the loader, Java, the client jar
  // and the assets are all it used to ensure — so a player who never pressed
  // Sync would join a server running a mod list that server stopped running.
  //
  // Before beginJob, not after: syncManifest starts a job of its own for this
  // profile, and beginJob aborts whatever it finds registered. Doing it the
  // other way round would have the sync cancel the launch that asked for it.
  if (profile.manifestUrl) {
    try {
      await syncManifest(profile.id);
    } catch (err) {
      // Cancelling is the player's own decision — do not then launch anyway.
      if (isCancellation(err)) throw err;
      // Anything else means the pack could not be reached at all: syncManifest
      // already falls back to the last manifest that validated. Starting with
      // what is installed beats refusing to start, and the log says why.
      log.warn(`Could not sync ${profile.name} before launch: ${err}`);
    }
  }

  // Everything from here to spawn is cancellable: it can run for minutes and
  // the user has no other way out short of killing the launcher.
  const signal = beginJob(profile.id);

  // Resolve paths
  const gameDir = paths.profileGameDir(profile.id);
  const versionsDir = path.join(paths.cacheDir, 'versions');
  const librariesDir = path.join(paths.cacheDir, 'libraries');
  const assetsDir = path.join(paths.cacheDir, 'assets');
  const nativesDir = path.join(paths.cacheDir, 'natives', profile.minecraftVersion);

  await fs.mkdir(gameDir, { recursive: true });
  await fs.mkdir(nativesDir, { recursive: true });

  // Fetch vanilla version metadata
  const vanillaMeta = await getVersionMeta(profile.minecraftVersion);

  // Ensure the profile's mod loader is installed before we resolve the launch
  // meta — the loader profile JSON is what supplies mainClass and the mod
  // loader's own libraries.
  if (profile.modLoader !== 'vanilla' && profile.modLoaderVersion) {
    const installed = await isLoaderInstalled(
      profile.modLoader,
      profile.modLoaderVersion,
      profile.minecraftVersion,
    );
    if (!installed) {
      log.info(`Loader ${profile.modLoader} ${profile.modLoaderVersion} missing — installing...`);
      await installLoader(profile.modLoader, profile.modLoaderVersion, profile.minecraftVersion);
    }
  }

  const meta = await resolveLaunchMeta(
    profile.modLoader,
    profile.modLoaderVersion,
    profile.minecraftVersion,
    vanillaMeta,
  );

  // Ensure Java
  const javaVersion = requiredJavaFor(profile.minecraftVersion, meta);
  const java = profile.customJavaPath
    ? await resolveChosenJava(profile.customJavaPath, javaVersion)
    : await ensureJavaVersion(javaVersion);

  // Download game files
  log.info('Ensuring client jar...');
  const clientJar = await ensureClientJar(
    versionsDir,
    profile.minecraftVersion,
    meta.downloads.client,
    signal,
  );

  log.info('Ensuring libraries...');
  const libClasspath = await ensureLibraries(librariesDir, meta, nativesDir, signal);

  log.info('Ensuring assets...');
  await ensureAssets(assetsDir, meta, signal);

  throwIfCancelled(signal, 'Launch');

  // Build classpath
  const cpSep = process.platform === 'win32' ? ';' : ':';
  const classpath = [...libClasspath, clientJar].join(cpSep);

  // Get auth info
  const authState = await getAuthState();
  const account = authState.accounts.find((a) => a.id === authState.activeAccountId);
  if (!account) {
    throw new Error('No active account — please log in first');
  }

  const { username, uuid } = account;

  // Offline is a per-launch decision with a global default. `undefined` means
  // "use the setting"; an explicit `false` is a deliberate "go online this
  // once" and must not be collapsed into the same thing.
  const settings = await getSettings();
  const offline = options.offlineMode ?? settings.offlineMode;

  // Online play needs the real Minecraft session token, refreshed if it is at
  // or near expiry. Offline accounts — and any account launched offline — use
  // the sentinel the game accepts for singleplayer/LAN.
  let accessToken = '0';
  if (account.type === 'microsoft' && !offline) {
    accessToken = await getMinecraftAccessToken(account.id);
  } else if (offline && account.type === 'microsoft') {
    log.info(`Offline launch for ${profile.name} — not contacting the auth servers.`);
  }

  // Build arguments
  const resolution = customResolution(profile.windowWidth, profile.windowHeight);
  const templateVars: Record<string, string> = {
    auth_player_name: username,
    // The Minecraft version, not the merged profile id. Forge and NeoForge
    // build `-DignoreList=client-extra,${version_name}.jar` out of this to keep
    // the *vanilla* jar off the module path, and that jar is named after the
    // Minecraft version. Using the profile id here launches a modded instance
    // that loads the unpatched client alongside the patched one.
    version_name: profile.minecraftVersion,
    game_directory: gameDir,
    assets_root: assetsDir,
    assets_index_name: meta.assetIndex.id,
    auth_uuid: uuid,
    auth_access_token: accessToken,
    clientid: '',
    auth_xuid: '',
    user_type: account?.type === 'microsoft' ? 'msa' : 'legacy',
    version_type: meta.type,
    natives_directory: nativesDir,
    launcher_name: 'raven-forge',
    // The build's own version, not a literal that stops being true the first
    // time package.json is bumped without this line.
    launcher_version: app.getVersion(),
    classpath: classpath,
    // Forge and NeoForge assemble an absolute `--module-path` from these two.
    // Leaving them out substitutes the empty string and the game dies with a
    // module-resolution error that names none of this.
    library_directory: librariesDir,
    classpath_separator: cpSep,
    // Resolution. The defaults are the game's own, and are what the feature
    // gate above leaves unused: with no custom size these variables are never
    // substituted into anything.
    resolution_width: String(resolution?.width ?? 854),
    resolution_height: String(resolution?.height ?? 480),
  };

  const features = launchFeatures(profile);

  // JVM args
  const jvmArgs: string[] = [
    `-Xmx${profile.allocatedRamMb}M`,
    `-Xms${Math.min(profile.allocatedRamMb, 512)}M`,
    `-Djava.library.path=${nativesDir}`,
    '-Dminecraft.launcher.brand=raven-forge',
  ];

  if (meta.arguments?.jvm) {
    const resolved = resolveConditionalArgs(meta.arguments.jvm, features);
    jvmArgs.push(...substituteVars(resolved, templateVars));
  } else {
    // Legacy fallback
    jvmArgs.push('-cp', classpath);
  }

  // Custom JVM args from profile
  if (profile.javaArgs) {
    jvmArgs.push(...profile.javaArgs.split(/\s+/).filter(Boolean));
  }

  // Main class
  jvmArgs.push(meta.mainClass);

  // Game args
  const gameArgs: string[] = [];
  if (meta.arguments?.game) {
    const resolved = resolveConditionalArgs(meta.arguments.game, features);
    gameArgs.push(...substituteVars(resolved, templateVars));
  } else if (meta.minecraftArguments) {
    // Legacy format
    gameArgs.push(...substituteVars(meta.minecraftArguments.split(/\s+/), templateVars));
    // The pre-1.13 argument string has no conditional section, so nothing in it
    // ever carried the resolution — the feature flag above reaches modern
    // metas only. Without this the setting silently does nothing on the older
    // versions, which are exactly the ones people run in a small window.
    if (resolution) {
      gameArgs.push('--width', String(resolution.width), '--height', String(resolution.height));
    }
  }

  // Quick connect
  if (options.quickConnect && profile.serverIp) {
    gameArgs.push('--server', profile.serverIp);
    if (profile.serverPort) {
      gameArgs.push('--port', String(profile.serverPort));
    }
  }

  const finalArgs = [...jvmArgs, ...gameArgs];

  // Stated in options.txt rather than passed as `--fullscreen`, because that
  // argument has no opposite. See `applyFullscreen`.
  if (profile.fullscreen !== undefined) {
    await applyFullscreen(gameDir, profile.fullscreen);
  }

  log.info(`Launching: ${java.path} ${finalArgs.join(' ').substring(0, 200)}...`);

  const child = spawn(java.path, finalArgs, {
    cwd: gameDir,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // The process is up; nothing left to cancel.
  endJob(profile.id);

  // Launch now tracked in gameRunning map for isGameRunning
  runningProcesses.set(profile.id, child);
  clearBuffer(profile.id);

  const startTime = Date.now();

  // Both ways out of here end the same way: with a file the player can attach to
  // a bug report without first having to learn where the launcher keeps its logs.
  const reportCrash = (
    exitCode: number,
    playTimeMinutes: number,
    logTail: string[],
    minecraftCrash?: { file: string; content: string },
    spawnError?: string,
  ) =>
    writeCrashReport({
      profile,
      exitCode,
      playTimeMinutes,
      startedAt: startTime,
      logTail,
      minecraftCrash,
      spawnError,
      gameDir,
      java,
      accountType: account.type,
      offlineLaunch: offline,
      // What must not reach the file. The token is a live credential; the other
      // two are simply the player's, and neither helps anyone read a stack trace.
      secrets: [accessToken, uuid, username],
    });

  // Never awaited: finding Discord's socket takes as long as it takes, and the
  // game is already running. A failure in here cannot reach the launch path.
  if (settings.discordRichPresence) {
    void setGamePresence({
      profileName: profile.name,
      minecraftVersion: profile.minecraftVersion,
      loader: loaderLabel(profile.modLoader),
      startedAt: startTime,
    });
  }

  const win = getMainWindow();

  // Notify renderer game started
  win?.webContents.send('game:started', profile.id);

  // Apply launcher behavior from settings
  switch (settings.launcherBehaviorOnLaunch) {
    case 'close': {
      child.on('exit', () => {
        getMainWindow()?.close();
      });
      break;
    }
    case 'minimize': {
      win?.minimize();
      break;
    }
    case 'keep-open':
    default:
      break;
  }

  child.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().split(/\r?\n/);
    for (const line of lines) {
      if (line) {
        log.info(`[MC:${profile.name}] ${line}`);
        emitLogLine(profile.id, line);
      }
    }
  });

  child.stderr?.on('data', (data: Buffer) => {
    const lines = data.toString().split(/\r?\n/);
    for (const line of lines) {
      if (line) {
        log.warn(`[MC:${profile.name}] ${line}`);
        emitLogLine(profile.id, line);
      }
    }
  });

  child.on('exit', (code) => {
    void (async () => {
      runningProcesses.delete(profile.id);
      clearGamePresence();
      const playTimeMinutes = Math.round((Date.now() - startTime) / 60000);
      const failed = code !== 0 && code !== null;

      // A non-zero exit is not yet a crash. Minecraft's shutdown watchdog halts
      // the JVM when something — nearly always a mod's leaked non-daemon thread
      // pool — keeps the process alive after the window is already gone, and
      // that arrives here looking exactly like a crash while the player has
      // simply finished playing. Their file says so, so read it before judging.
      const minecraftCrash = failed ? await readMinecraftCrash(gameDir, startTime) : undefined;
      const hungOnExit = isShutdownWatchdogCrash(minecraftCrash);
      const crashed = failed && !hungOnExit;

      const logTail = crashed ? getLogTail(profile.id, 100) : undefined;
      const exitInfo: GameExitInfo = {
        profileId: profile.id,
        exitCode: code ?? -1,
        crashed,
        logTail,
        playTimeMinutes,
        // Written before the buffer is cleared below, and before the renderer is
        // told anything — the card offers the file, so it has to exist by then.
        reportPath: crashed
          ? await reportCrash(code ?? -1, playTimeMinutes, logTail ?? [], minecraftCrash)
          : undefined,
      };

      if (hungOnExit) {
        log.warn(
          `${profile.name} finished, but the JVM would not exit and Minecraft's shutdown ` +
            `watchdog halted it (code ${code}). The session had already ended, so this is ` +
            'not reported as a crash.',
        );
      }
      log.info(`Game exited for ${profile.name} with code ${code} (played ${playTimeMinutes} min)`);

      // `lastPlayed` and total play time are both shown in the profile list and
      // nothing was ever writing them. Persist before announcing the exit, so
      // the renderer's refresh reads the updated numbers rather than racing it.
      try {
        await recordPlaySession(profile.id, playTimeMinutes);
      } catch (err) {
        log.warn(`Could not record play time for ${profile.name}:`, err);
      }

      getMainWindow()?.webContents.send('game:exited', exitInfo);
      clearBuffer(profile.id);
    })();
  });

  child.on('error', (err) => {
    void (async () => {
      runningProcesses.delete(profile.id);
      clearGamePresence();
      log.error(`Game process error for ${profile.name}:`, err);
      const logTail = getLogTail(profile.id, 100);
      const exitInfo: GameExitInfo = {
        profileId: profile.id,
        exitCode: -1,
        crashed: true,
        logTail,
        playTimeMinutes: 0,
        // The process never ran, so there is no output and no crash file of the
        // game's own — the error itself is the whole finding, and the report is
        // where it says which Java it tried to start.
        reportPath: await reportCrash(-1, 0, logTail, undefined, err.message),
      };
      getMainWindow()?.webContents.send('game:exited', exitInfo);
      clearBuffer(profile.id);
    })();
  });
}

/** How long a JVM gets to shut down politely before it is killed outright. */
const KILL_GRACE_MS = 10_000;

/**
 * Stop the game, and do not report success until it has actually stopped.
 *
 * This used to drop the process from the map the instant `SIGTERM` was sent. A
 * JVM that ignores the signal — which is what a hung shutdown *is* — stayed
 * alive while `isGameRunning` said no, so the launcher would happily start a
 * second instance against the same game directory and the two would fight over
 * the same world saves.
 */
export async function killGame(profileId: string): Promise<void> {
  const child = runningProcesses.get(profileId);
  if (!child) throw new Error('Game is not running');

  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGTERM');

  const timer = setTimeout(() => {
    if (!child.killed || runningProcesses.has(profileId)) {
      log.warn(`Game for ${profileId} ignored SIGTERM after ${KILL_GRACE_MS}ms — sending SIGKILL`);
      child.kill('SIGKILL');
    }
  }, KILL_GRACE_MS);

  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }

  // The `exit` handler installed at launch is what removes it from the map; this
  // only guarantees the entry is gone even if that handler was never attached.
  runningProcesses.delete(profileId);
  log.info(`Killed game for profile ${profileId}`);
}

export function isGameRunning(profileId: string): boolean {
  return runningProcesses.has(profileId);
}

/**
 * Any profile at all. Asked before the data directory moves: the game holds
 * open handles all over the profile it is running from, and on Windows that
 * alone makes the directory unmovable.
 */
export function anyGameRunning(): boolean {
  return runningProcesses.size > 0;
}

export async function launchGame(options: LaunchOptions): Promise<void> {
  try {
    await runLaunch(options);
  } catch (err) {
    endJob(options.profileId);
    // Cancelling is the user's own decision, not a failure to report back.
    if (isCancellation(err)) {
      log.info(`Launch cancelled for profile ${options.profileId}`);
      return;
    }
    throw err;
  }
}
