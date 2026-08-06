import { spawn, exec, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs/promises';
import { log } from '../../main/logger';
import { paths } from '../config/paths';
import { getMainWindow } from '../../main/window';
import { getSettings } from '../config/settings-manager';
import { getAuthState, getMinecraftAccessToken } from '../auth/microsoft-auth';
import { getProfile, recordPlaySession } from '../profiles/profile-manager';
import { ensureJavaVersion } from '../java/java-manager';
import { installLoader, isLoaderInstalled } from '../modloader/loader-manager';
import { resolveLaunchMeta } from '../modloader/loader-profile';
import { getVersionMeta } from './version-manifest';
import { ensureClientJar, ensureLibraries, ensureAssets } from './asset-downloader';
import { beginJob, endJob, isCancellation, throwIfCancelled } from '../util/cancellation';

const execAsync = promisify(exec);
import type { LaunchOptions, GameLogLine, GameExitInfo, Profile } from '../../shared/ipc-types';
import { resolveConditionalArgs, substituteVars } from './launch-args';
import { requiredJavaFor } from './java-requirement';

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
    has_custom_resolution: profile.windowWidth != null && profile.windowHeight != null,
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
async function runLaunch(options: LaunchOptions): Promise<void> {
  const profile = await getProfile(options.profileId);
  if (!profile) throw new Error(`Profile ${options.profileId} not found`);

  if (runningProcesses.has(options.profileId)) {
    throw new Error('Game is already running for this profile');
  }

  log.info(`Launching game for profile: ${profile.name} (MC ${profile.minecraftVersion})`);

  // Everything from here to spawn is cancellable: it can run for minutes and
  // the user has no other way out short of killing the launcher.
  const signal = beginJob(profile.id);

  // Resolve paths
  const gameDir = profile.gameDirectory
    ? path.resolve(profile.gameDirectory)
    : paths.profileGameDir(profile.id);
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
    ? { path: profile.customJavaPath }
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
    launcher_version: '0.1.0',
    classpath: classpath,
    // Forge and NeoForge assemble an absolute `--module-path` from these two.
    // Leaving them out substitutes the empty string and the game dies with a
    // module-resolution error that names none of this.
    library_directory: librariesDir,
    classpath_separator: cpSep,
    // Resolution
    resolution_width: String(profile.windowWidth ?? 854),
    resolution_height: String(profile.windowHeight ?? 480),
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
  }

  // Quick connect
  if (options.quickConnect && profile.serverIp) {
    gameArgs.push('--server', profile.serverIp);
    if (profile.serverPort) {
      gameArgs.push('--port', String(profile.serverPort));
    }
  }

  // Fullscreen
  if (profile.fullscreen) {
    gameArgs.push('--fullscreen');
  }

  const finalArgs = [...jvmArgs, ...gameArgs];

  // Pre-launch hook — a failing hook aborts the launch so the user isn't left
  // guessing why the game started without whatever the hook was meant to set up.
  if (profile.preLaunchCommand) {
    log.info(`Running pre-launch command for ${profile.name}: ${profile.preLaunchCommand}`);
    try {
      const { stdout, stderr } = await execAsync(profile.preLaunchCommand, {
        cwd: gameDir,
        timeout: 120000,
      });
      if (stdout.trim()) log.info(`[pre-launch] ${stdout.trim()}`);
      if (stderr.trim()) log.warn(`[pre-launch] ${stderr.trim()}`);
    } catch (err) {
      throw new Error(`Pre-launch command failed: ${err instanceof Error ? err.message : err}`);
    }
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
      const playTimeMinutes = Math.round((Date.now() - startTime) / 60000);
      const crashed = code !== 0 && code !== null;
      const exitInfo: GameExitInfo = {
        profileId: profile.id,
        exitCode: code ?? -1,
        crashed,
        logTail: crashed ? getLogTail(profile.id, 100) : undefined,
        playTimeMinutes,
      };

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
    runningProcesses.delete(profile.id);
    log.error(`Game process error for ${profile.name}:`, err);
    const exitInfo: GameExitInfo = {
      profileId: profile.id,
      exitCode: -1,
      crashed: true,
      logTail: getLogTail(profile.id, 100),
      playTimeMinutes: 0,
    };
    getMainWindow()?.webContents.send('game:exited', exitInfo);
    clearBuffer(profile.id);
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
