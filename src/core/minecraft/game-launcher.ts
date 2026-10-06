// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { app } from 'electron';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import readline from 'node:readline';
import type { Readable } from 'node:stream';
import { log } from '../../main/logger';
import { paths } from '../config/paths';
import { getMainWindow } from '../../main/window';
import { getSettings } from '../config/settings-manager';
import { getAuthState, getMinecraftAccessToken } from '../auth/microsoft-auth';
import { getProfile, recordPlaySession, updateProfile } from '../profiles/profile-manager';
import { setGamePresence, clearGamePresence } from '../discord/rich-presence';
import { loaderLabel } from '../../shared/labels';
import { syncManifest } from '../mods/mod-sync';
import { ensureJavaVersion, resolveChosenJava } from '../java/java-manager';
import {
  installLoader,
  isLoaderInstalled,
  resolveDefaultLoaderVersion,
} from '../modloader/loader-manager';
import { resolveLaunchMeta } from '../modloader/loader-profile';
import { getVersionMeta } from './version-manifest';
import {
  ensureClientJar,
  ensureLibraries,
  ensureAssets,
  type GameFileOptions,
} from './asset-downloader';
import { beginJob, endJob, isCancellation, throwIfCancelled } from '../util/cancellation';
import { withProgress } from '../util/progress';
import { machineMemoryMb } from '../util/machine-memory';
import { formatRamGb, ramAdvice, recommendedRamMb } from '../../shared/memory';
import {
  isShutdownWatchdogCrash,
  readMinecraftCrash,
  redactTokens,
  writeCrashReport,
  type CrashReportInput,
} from '../diagnostics/crash-report';

import type { LaunchOptions, GameLogLine, GameExitInfo, Profile } from '../../shared/ipc-types';
import {
  customResolution,
  resolveConditionalArgs,
  splitArguments,
  substituteVars,
} from './launch-args';
import { log4jConfigArgument } from './log4j-config';
import { requiredJavaFor } from './java-requirement';
import { applyProfileOptions, languageCodeFor } from './options-file';
import { RefusedError } from '../util/refusal';
import { errorText } from '../util/error-text';

// Track running processes by profileId
const runningProcesses = new Map<string, ChildProcess>();

/** The processes `killGame` was asked to end, so their exit can be read as that. */
const stopRequested = new WeakSet<ChildProcess>();

/**
 * Whether the way the game ended is a failure to look into.
 *
 * The exit code alone answers this wrongly twice over on Linux. A JVM that is
 * sent SIGTERM handles it, shuts down and exits 143 — so pressing Stop produced
 * a crash card and a crash report. And a JVM that a signal *kills* has no exit
 * code at all: the OOM killer `assertRamFits` describes, or a native crash
 * ending in SIGABRT, arrived as `code === null`, which used to read as a clean
 * exit and left the player with a game that vanished and nothing said.
 *
 * So: a stop that was asked for is never a failure, whatever the process then
 * reports — 143, a signal, or on Windows, where the stop is `TerminateProcess`,
 * the code that call was given. Otherwise dying of a signal always is one, and
 * an exit code is one unless it is zero.
 */
export function endedInFailure(
  code: number | null,
  signal: NodeJS.Signals | null,
  stopWasRequested: boolean,
): boolean {
  if (stopWasRequested) return false;
  return signal !== null || code !== 0;
}

/** How much of a game's output is kept for the console and the crash card. */
const LOG_LINES_KEPT = 500;

// Per-profile log ring buffer
const logBuffers = new Map<string, GameLogLine[]>();

function clearBuffer(profileId: string): void {
  logBuffers.delete(profileId);
  unsent.delete(profileId);
}

/** The newest output of a profile's game, oldest line first. */
export function getLogLines(profileId: string): GameLogLine[] {
  return logBuffers.get(profileId) ?? [];
}

/** The last `n` lines as plain text, which is what a crash report quotes. */
export function getLogTail(profileId: string, n = 100): string[] {
  return n > 0
    ? getLogLines(profileId)
        .slice(-n)
        .map((line) => line.message)
    : [];
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

/**
 * A line of game output without the colour codes some loaders write into it.
 *
 * Forge 28 on Minecraft 1.14.4 colours its console whether or not it is one, so
 * every line arrives as `ESC[32m[12:00:00] [main/INFO] …`. Nothing that reads
 * the output here is a terminal: the console, the launcher's log and the crash
 * report all showed the codes as text.
 *
 * Built from the character code because a control character written into a
 * pattern is what the linter is there to catch.
 */
const COLOUR_CODE = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');

export function withoutColourCodes(line: string): string {
  return line.replace(COLOUR_CODE, '');
}

/** How long lines are gathered before the console is sent them. */
const LOG_FLUSH_MS = 100;

/** Lines the renderer has not been sent yet, per profile. */
const unsent = new Map<string, GameLogLine[]>();
let flushTimer: NodeJS.Timeout | undefined;

/**
 * Hand the console what has arrived since the last time.
 *
 * In batches, and only while the console is switched on. A loader's startup is
 * several thousand lines in a few seconds; one message each kept the renderer
 * busy re-rendering a list — whether or not anything was showing it, and the
 * setting that shows it is off unless somebody turned it on.
 */
async function flushLogLines(): Promise<void> {
  flushTimer = undefined;
  const batches = [...unsent];
  unsent.clear();
  if (!(await getSettings()).showLiveConsole) return;
  for (const [profileId, lines] of batches) {
    getMainWindow()?.webContents.send('game:log', profileId, lines);
  }
}

function emitLogLine(profileId: string, rawLine: string): void {
  const message = rawLine.trimEnd();
  const line: GameLogLine = {
    timestamp: new Date().toISOString(),
    level: detectLogLevel(message),
    message,
  };

  const buf = logBuffers.get(profileId) ?? [];
  buf.push(line);
  if (buf.length > LOG_LINES_KEPT) buf.shift();
  logBuffers.set(profileId, buf);

  const waiting = unsent.get(profileId) ?? [];
  waiting.push(line);
  unsent.set(profileId, waiting);
  flushTimer ??= setTimeout(() => void flushLogLines(), LOG_FLUSH_MS);
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
  throw new RefusedError(
    { key: 'launchError.ramTooBig', vars: { allocated, total, recommended } },
    `This profile allocates ${allocated} of RAM and this machine has ${total}. Minecraft cannot ` +
      `start with more memory than the machine has — lower it in the profile editor, where ` +
      `${recommended} suits this one.`,
  );
}

/**
 * Give a modded profile with no loader build chosen the build it should have,
 * and write that down.
 *
 * Without a version there is nothing to install and no loader profile to read,
 * and the launch used to carry on regardless: it skipped the install, found no
 * loader metadata and started plain Minecraft, with the profile still saying
 * NeoForge and its mods sitting in `mods/` unread. Leaving the version at the
 * editor's "latest" was all it took.
 *
 * Pinned rather than looked up at every launch. A profile that follows the
 * newest build changes under a working mod set without anyone having asked, and
 * cannot start at all when the loader's servers are unreachable.
 */
export async function withLoaderVersion(profile: Profile): Promise<Profile> {
  if (profile.modLoader === 'vanilla' || profile.modLoaderVersion) return profile;

  const label = loaderLabel(profile.modLoader);
  const refuse = (cause?: unknown) =>
    new RefusedError(
      {
        key: 'launchError.loaderVersionUnknown',
        vars: { loader: label, version: profile.minecraftVersion },
      },
      `No ${label} build could be chosen for Minecraft ${profile.minecraftVersion}` +
        (cause ? `: ${cause instanceof Error ? cause.message : String(cause)}` : ''),
    );

  let version: string | undefined;
  try {
    version = await resolveDefaultLoaderVersion(profile.modLoader, profile.minecraftVersion);
  } catch (err) {
    throw refuse(err);
  }
  if (!version) throw refuse();

  log.info(`${profile.name} had no ${label} build chosen — using ${version}`);
  return updateProfile(profile.id, { modLoaderVersion: version });
}

/**
 * The second half of "close the launcher when the game starts": what becomes of
 * it once the game is over.
 *
 * At launch the window is hidden rather than closed. Closing the last window
 * quits the app, and the game's exit would then have nobody to report to: no
 * play time recorded, no crash report written. The setting used to wait and
 * close the window at exit instead — so it did nothing while the game ran, and
 * raced the bookkeeping it had been registered ahead of. Hidden, the process
 * stays and this decides how it ends:
 *
 * - a crash brings the window back. The crash card is the one thing the player
 *   now needs, and a launcher that had quit could not show it;
 * - anything else quits, which is what "close" promised — unless the player has
 *   opened the launcher again in the meantime and is looking at it, or another
 *   profile's game is running or being got ready and still needs this process.
 */
export function afterGameWhenClosed(state: {
  crashed: boolean;
  windowVisible: boolean;
  othersRunning: boolean;
}): 'show' | 'quit' | 'stay' {
  if (state.crashed) return 'show';
  return state.windowVisible || state.othersRunning ? 'stay' : 'quit';
}

/**
 * Left in a profile's folder when its game crashed, and taken away by the next
 * launch once it has read every game file back — see `GameFileOptions.thorough`.
 */
function recheckMarker(profileId: string): string {
  return path.join(paths.profileDir(profileId), '.recheck-game-files');
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * The binary to start the game with: `javaw.exe` where there is one.
 *
 * `java.exe` is a console program, and the packaged launcher has no console for
 * it to share, so Windows opens one — a black window that stays for the whole
 * session and takes the game with it when closed. `javaw.exe` is the same JVM
 * without one; its output still arrives down the pipes. Hiding the window
 * through `windowsHide` instead is not an option for a game: that also tells the
 * process to start with its first window hidden.
 */
export async function windowlessJava(
  javaPath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  if (platform !== 'win32' || path.basename(javaPath).toLowerCase() !== 'java.exe') {
    return javaPath;
  }
  const javaw = path.join(path.dirname(javaPath), 'javaw.exe');
  return (await exists(javaw)) ? javaw : javaPath;
}

/** The cancellable job a launch registered, once it has: `launchGame` ends it. */
interface LaunchJob {
  signal?: AbortSignal;
}

/**
 * Run the prepare phase and spawn the game.
 *
 * Wrapped by `launchGame` so the job registration is torn down on every exit
 * path — a throw between `beginJob` and the spawn would otherwise leave a dead
 * controller behind, and the UI would keep offering to cancel nothing.
 */
async function runLaunch(options: LaunchOptions, job: LaunchJob): Promise<void> {
  const stored = await getProfile(options.profileId);
  if (!stored) throw new Error(`Profile ${options.profileId} not found`);

  assertRamFits(stored);

  // Asked first. It used to be found out after the loader, the Java runtime and
  // every asset had been fetched — minutes of downloading to be told to sign in.
  const authState = await getAuthState();
  const account = authState.accounts.find((a) => a.id === authState.activeAccountId);
  if (!account) {
    throw new RefusedError(
      { key: 'launchError.noAccount' },
      'No active account — please log in first',
    );
  }

  log.info(`Launching game for profile: ${stored.name} (MC ${stored.minecraftVersion})`);

  // A profile that follows a pack is brought up to the pack before it starts.
  // Nothing else in this path touches mods — the loader, Java, the client jar
  // and the assets are all it used to ensure — so a player who never pressed
  // Sync would join a server running a mod list that server stopped running.
  //
  // Before beginJob, not after: syncManifest starts a job of its own for this
  // profile, and beginJob aborts whatever it finds registered. Doing it the
  // other way round would have the sync cancel the launch that asked for it.
  if (stored.manifestUrl) {
    try {
      await syncManifest(stored.id);
    } catch (err) {
      // Cancelling is the player's own decision — do not then launch anyway.
      if (isCancellation(err)) throw err;
      // Anything else means the sync did not finish — the pack unreachable with
      // nothing cached, a file that failed its hash. Starting with what is
      // installed beats refusing to start, and the log says why.
      log.warn(`Could not sync ${stored.name} before launch: ${errorText(err)}`);
    }
  }

  // Read again, after the sync: a pack can move the profile to a newer loader
  // build, and the launch has to install and start that one.
  const profile = await withLoaderVersion((await getProfile(stored.id)) ?? stored);

  // Everything from here to spawn is cancellable: it can run for minutes and
  // the user has no other way out short of killing the launcher.
  const signal = beginJob(profile.id);
  job.signal = signal;

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
      await installLoader(profile.modLoader, profile.modLoaderVersion, profile.minecraftVersion, {
        signal,
        javaPath: profile.customJavaPath,
      });
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
    : await ensureJavaVersion(javaVersion, signal);

  // Download game files. Read back by hash rather than by size when the last
  // run of this profile crashed: a file that went bad on disk is one of the
  // things that crash can have been.
  const recheck = recheckMarker(profile.id);
  const files: GameFileOptions = { signal, thorough: await exists(recheck) };
  if (files.thorough) log.info(`${profile.name} crashed last time — checking every game file`);

  log.info('Ensuring client jar...');
  const clientJar = await ensureClientJar(
    versionsDir,
    profile.minecraftVersion,
    meta.downloads.client,
    files,
  );

  log.info('Ensuring libraries...');
  const libClasspath = await ensureLibraries(librariesDir, meta, nativesDir, files);

  log.info('Ensuring assets...');
  const gameAssets = await ensureAssets(assetsDir, meta, { ...files, gameDir });

  throwIfCancelled(signal, 'Launch');
  if (files.thorough) await fs.rm(recheck, { force: true });

  // Build classpath
  const cpSep = process.platform === 'win32' ? ';' : ':';
  const classpath = [...libClasspath, clientJar].join(cpSep);

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
    // The three the versions up to 1.7.2 are started with. They take the token
    // and the profile as one argument, find their assets by name in a folder of
    // their own, and — up to 1.8.9 — expect a JSON object of account properties
    // where an empty string is not one.
    auth_session: accessToken === '0' ? '-' : `token:${accessToken}:${uuid}`,
    game_assets: gameAssets,
    user_properties: '{}',
    clientid: '',
    auth_xuid: '',
    user_type: account.type === 'microsoft' ? 'msa' : 'legacy',
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

  // Ahead of the version's own arguments and the profile's, because the last
  // `-D` for a property is the one the JVM keeps: a loader or a player that
  // names a logging configuration of their own still gets it.
  const log4jConfig = await log4jConfigArgument(path.join(paths.cacheDir, 'log4j'), meta.libraries);
  if (log4jConfig) jvmArgs.push(log4jConfig);

  if (meta.arguments?.jvm) {
    const resolved = resolveConditionalArgs(meta.arguments.jvm, features);
    jvmArgs.push(...substituteVars(resolved, templateVars));
  } else {
    // Legacy fallback
    jvmArgs.push('-cp', classpath);
  }

  // Custom JVM args from profile
  if (profile.javaArgs) {
    jvmArgs.push(...splitArguments(profile.javaArgs));
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
  // argument has no opposite. See `applyProfileOptions`.
  try {
    await applyProfileOptions(gameDir, {
      fullscreen: profile.fullscreen,
      language:
        profile.gameLanguage && languageCodeFor(profile.minecraftVersion, profile.gameLanguage),
    });
  } catch (err) {
    // The game can still be started; it starts with what the file already says.
    log.warn(`Could not write the game options of ${profile.name}: ${String(err)}`);
  }

  const javaBinary = await windowlessJava(java.path);
  log.info(`Launching: ${javaBinary} ${finalArgs.join(' ').substring(0, 200)}...`);

  const child = spawn(javaBinary, finalArgs, {
    cwd: gameDir,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // The process is up; nothing left to cancel.
  endJob(profile.id, signal);

  // From here `isGameRunning` answers yes for this profile.
  runningProcesses.set(profile.id, child);
  clearBuffer(profile.id);

  const startTime = Date.now();

  // Both ways out of here end the same way: with a file the player can attach to
  // a bug report without first having to learn where the launcher keeps its logs.
  const reportCrash = (
    ended: Pick<CrashReportInput, 'exitCode' | 'signal' | 'minecraftCrash' | 'spawnError'>,
    playTimeMinutes: number,
    logTail: string[],
  ) =>
    writeCrashReport({
      profile,
      ...ended,
      playTimeMinutes,
      logTail,
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
    void setGamePresence(profile.id, {
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
  const closedForGame = settings.launcherBehaviorOnLaunch === 'close';
  /** Run last by both ways out below, once the session is on record. */
  const finishClosing = (crashed: boolean) => {
    const window = getMainWindow();
    const next = afterGameWhenClosed({
      crashed,
      windowVisible: window?.isVisible() ?? false,
      // Being got ready counts as much as running: quitting would stop that
      // launch half-way through its downloads.
      othersRunning: isLaunchInProgress(),
    });
    if (next === 'show') window?.show();
    else if (next === 'quit') app.quit();
  };

  switch (settings.launcherBehaviorOnLaunch) {
    case 'close': {
      win?.hide();
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

  // Read as lines, not as chunks. A pipe hands over whatever has arrived, so a
  // chunk ends wherever it happens to — mid-line, and mid-character for anything
  // outside ASCII. Splitting each chunk on its own made two lines out of one,
  // the second without the level tag `detectLogLevel` reads, and turned the two
  // halves of a split `ż` into replacement characters.
  const passOn = (stream: Readable | null, record: (text: string) => void) => {
    if (!stream) return;
    readline.createInterface({ input: stream, crlfDelay: Infinity }).on('line', (raw) => {
      // Before anything holds on to it: the log, the ring buffer the console
      // and the exit card read, and the renderer all get the line from here.
      const line = redactTokens(withoutColourCodes(raw), accessToken);
      if (!line) return;
      record(`[MC:${profile.name}] ${line}`);
      emitLogLine(profile.id, line);
    });
  };
  passOn(child.stdout, (text) => log.info(text));
  passOn(child.stderr, (text) => log.warn(text));

  child.on('exit', (code, signal) => {
    void (async () => {
      runningProcesses.delete(profile.id);
      void clearGamePresence(profile.id);
      const playTimeMinutes = Math.round((Date.now() - startTime) / 60000);
      const failed = endedInFailure(code, signal, stopRequested.has(child));

      // A non-zero exit is not yet a crash. Minecraft's shutdown watchdog halts
      // the JVM when something — nearly always a mod's leaked non-daemon thread
      // pool — keeps the process alive after the window is already gone, and
      // that arrives here looking exactly like a crash while the player has
      // simply finished playing. Their file says so, so read it before judging.
      const minecraftCrash = failed ? await readMinecraftCrash(gameDir, startTime) : undefined;
      const hungOnExit = isShutdownWatchdogCrash(minecraftCrash);
      const crashed = failed && !hungOnExit;

      // A crash that a bad file caused is found by reading the files back, and
      // that is too slow to do at every launch — so it is asked for here.
      if (crashed) await fs.writeFile(recheckMarker(profile.id), '').catch(() => undefined);

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
          ? await reportCrash(
              { exitCode: code ?? -1, signal, minecraftCrash },
              playTimeMinutes,
              logTail ?? [],
            )
          : undefined,
      };

      if (hungOnExit) {
        log.warn(
          `${profile.name} finished, but the JVM would not exit and Minecraft's shutdown ` +
            `watchdog halted it (code ${code}). The session had already ended, so this is ` +
            'not reported as a crash.',
        );
      }
      log.info(
        `Game exited for ${profile.name} with ${signal ? `signal ${signal}` : `code ${code}`} ` +
          `(played ${playTimeMinutes} min)`,
      );

      // `lastPlayed` and total play time are both shown in the profile list and
      // nothing was ever writing them. Persist before announcing the exit, so
      // the renderer's refresh reads the updated numbers rather than racing it.
      try {
        await recordPlaySession(profile.id, playTimeMinutes);
      } catch (err) {
        log.warn(`Could not record play time for ${profile.name}:`, err);
      }

      // The console gets the game's last words before it is told the game is over.
      await flushLogLines();
      getMainWindow()?.webContents.send('game:exited', exitInfo);
      clearBuffer(profile.id);
      if (closedForGame) finishClosing(crashed);
    })();
  });

  child.on('error', (err) => {
    void (async () => {
      runningProcesses.delete(profile.id);
      void clearGamePresence(profile.id);
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
        reportPath: await reportCrash({ exitCode: -1, spawnError: err.message }, 0, logTail),
      };
      getMainWindow()?.webContents.send('game:exited', exitInfo);
      clearBuffer(profile.id);
      if (closedForGame) finishClosing(true);
    })();
  });
}

/** How long a JVM gets to shut down politely before it is killed outright. */
const KILL_GRACE_MS = 10_000;

/**
 * Ask the game to close, in the way the platform has for asking.
 *
 * Elsewhere that is SIGTERM, which the JVM turns into an orderly shutdown. On
 * Windows there is no such signal: `kill()` there is `TerminateProcess`, at
 * once and whatever was passed, so Stop used to end the game in the middle of
 * whatever it was writing. `taskkill` without `/F` asks the game's window to
 * close, which is the same request as the X in its corner.
 */
function requestStop(child: ChildProcess): void {
  if (process.platform !== 'win32' || child.pid === undefined) {
    child.kill('SIGTERM');
    return;
  }
  execFile('taskkill', ['/PID', String(child.pid)], { windowsHide: true }, (err) => {
    if (err) child.kill();
  });
}

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
  stopRequested.add(child);
  requestStop(child);

  // Cleared below the moment the process exits, so firing means it has not.
  const timer = setTimeout(() => {
    log.warn(`Game for ${profileId} was still running ${KILL_GRACE_MS}ms after Stop — killing it`);
    child.kill('SIGKILL');
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

/** Running, or between Play and the game existing — see `preparing`. */
export function isGameBusy(profileId: string): boolean {
  return runningProcesses.has(profileId) || preparing.has(profileId);
}

/**
 * Profiles between "launch pressed" and `spawn`.
 *
 * `runningProcesses` cannot answer this: it is only populated after the process
 * exists, so it says whether a profile is *playing*, never whether one is
 * already being got ready. The guard that used to consult it therefore let two
 * launches of the same profile through whenever the second arrived during the
 * first's prepare phase — and those two are not merely redundant. The second
 * one's `beginJob` aborts the first one's signal, while both go on writing the
 * same JRE directory, which `extractArchive` begins by deleting.
 */
const preparing = new Set<string>();

/**
 * Any profile at all, playing or being got ready. Asked before the data
 * directory moves: a running game holds open handles all over the profile it
 * runs from, and a launch still downloading is writing into the very
 * directories that are about to be carried away — files it creates after the
 * move has listed what to take would be deleted with the originals.
 */
export function isLaunchInProgress(): boolean {
  return runningProcesses.size > 0 || preparing.size > 0;
}

export async function launchGame(options: LaunchOptions): Promise<void> {
  if (runningProcesses.has(options.profileId)) {
    throw new RefusedError(
      { key: 'launchError.alreadyRunning' },
      'Game is already running for this profile',
    );
  }
  if (preparing.has(options.profileId)) {
    throw new RefusedError(
      { key: 'launchError.alreadyPreparing' },
      'This profile is already being prepared',
    );
  }

  preparing.add(options.profileId);
  const job: LaunchJob = {};
  try {
    // Whichever way the preparation ends, its progress bars end with it.
    await withProgress(() => runLaunch(options, job));
  } catch (err) {
    // Only a job this launch registered. One refused before it got that far has
    // none, and ending "the profile's job" here used to unregister a sync that
    // was running for the same profile.
    if (job.signal) endJob(options.profileId, job.signal);
    // Cancelling is the user's own decision, not a failure to report back.
    if (isCancellation(err)) {
      log.info(`Launch cancelled for profile ${options.profileId}`);
      return;
    }
    throw err;
  } finally {
    preparing.delete(options.profileId);
  }
}
