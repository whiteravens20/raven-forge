// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs';
import path from 'node:path';
import {
  DIR_BROWSER,
  DIR_CACHE,
  DIR_CRASH_REPORTS,
  DIR_JAVA,
  DIR_LOADERS,
  DIR_LOGS,
  DIR_PROFILES,
  FILE_AUTH,
  FILE_DATA_ROOT_POINTER,
  FILE_PROFILES,
  FILE_SETTINGS,
  HOME_DIR_NAME,
  LEGACY_HOME_DIR_NAME,
} from '../../shared/constants';

/**
 * The launcher's home: the one directory whose place is known before anything
 * has been read.
 *
 * It is Electron's `userData`, and it is chosen here rather than left to
 * Electron for one reason — the name. Electron names the directory after the
 * product, which put every profile, every mod and every Java runtime under
 * `…/Raven Forge Launcher/…`: a path with spaces in it, handed to a game and to
 * a few hundred mods that are not all careful about that. Players asked for a
 * default without them.
 *
 * So the home is `<appData>/raven-forge-launcher`, the same name the Linux
 * binary, the desktop entry and the updater's cache already carry. An install
 * that predates this has its data in the old directory, and that directory is
 * renamed, once, the first time this build starts — before the single-instance
 * lock and before Chromium opens anything, which is the only moment the whole
 * tree can be moved in one step.
 *
 * Everything here is synchronous and takes its inputs as arguments. It runs
 * before the app is ready, and it is the code that decides where a person's
 * worlds are, so it has to be testable against a real directory without
 * pretending to be Electron.
 */

/**
 * What sits at the top of the home and is the launcher's own, as opposed to the
 * embedded browser's. The list is closed on purpose: it is the launcher's side
 * that is small and known, and Chromium's that changes from one release to the
 * next.
 */
const LAUNCHER_ENTRIES = new Set([
  FILE_SETTINGS,
  FILE_PROFILES,
  FILE_AUTH,
  FILE_DATA_ROOT_POINTER,
  DIR_PROFILES,
  DIR_LOADERS,
  DIR_JAVA,
  DIR_CACHE,
  DIR_LOGS,
  DIR_CRASH_REPORTS,
  DIR_BROWSER,
  // electron-updater's staged-rollout id; it looks for it here by name.
  '.updaterId',
]);

/** A state file set aside because it would not parse, or one mid-write. */
function isLauncherSidecar(name: string): boolean {
  return /^(settings|profiles|auth)\.json\./.test(name) || name.startsWith('.raven-forge-');
}

export interface AppHome {
  /** The directory to use as `userData`. */
  dir: string;
  /**
   * Where Chromium keeps its own files. A subdirectory of the home, so the
   * launcher's handful of entries are not lost among two dozen of the
   * browser's — except in the one case below, where the home is left exactly
   * as the older build knew it.
   */
  browserDir: string;
  /** Set when the old-named directory was renamed to the new one just now. */
  migratedFrom?: string;
  /**
   * Set when the old-named directory is being used as it stands, because it
   * could not be renamed this time. Nothing in it is rearranged; the next start
   * tries again.
   */
  legacyInUse?: string;
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists and is somebody else's, which is still alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Whether something is running out of `dir` right now.
 *
 * Windows needs no asking: it refuses to rename a directory with an open file
 * or a working directory anywhere beneath it, so the rename itself is the
 * check. Linux renames it regardless and lets whoever was inside carry on with
 * paths that no longer exist — a game left running by an earlier session would
 * go on saving its world to a directory it then recreates, empty, beside the
 * real one. So there it is asked first.
 */
export function isDirectoryInUse(dir: string, platform: NodeJS.Platform): boolean {
  if (platform === 'win32') return false;

  // Another copy of the launcher: Chromium leaves `SingletonLock` as a symlink
  // to `<host>-<pid>` for as long as it runs.
  try {
    const owner = fs.readlinkSync(path.join(dir, 'SingletonLock'));
    const pid = Number(owner.slice(owner.lastIndexOf('-') + 1));
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && isAlive(pid)) return true;
  } catch {
    /* no lock, or not a link: nobody is holding it */
  }

  if (platform !== 'linux') return false;

  // A game: it is started with a profile's `.minecraft` as its working
  // directory, and the kernel will say so.
  const inside = dir.endsWith(path.sep) ? dir : dir + path.sep;
  let pids: string[];
  try {
    pids = fs.readdirSync('/proc').filter((entry) => /^\d+$/.test(entry));
  } catch {
    return false;
  }
  for (const pid of pids) {
    if (Number(pid) === process.pid) continue;
    try {
      const cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
      if (cwd === dir || cwd.startsWith(inside)) return true;
    } catch {
      /* gone already, or another user's: not ours to ask about */
    }
  }
  return false;
}

/**
 * Decide where the home is, renaming the old-named directory into place when
 * this is the first start after an update.
 *
 * `envRoot` is `RAVENFORGE_DATA_DIR`. A portable install sets it to carry its
 * data on the same stick as the binary, and until now only the data went there:
 * the log, the crash reports and the whole browser profile were still written
 * to the host machine. With it set the home is that directory too, so nothing
 * is.
 */
export function resolveAppHome(
  appData: string,
  envRoot: string | undefined,
  platform: NodeJS.Platform,
): AppHome {
  if (envRoot && path.isAbsolute(envRoot)) {
    const dir = path.resolve(envRoot);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      /* not creatable: fall through to the ordinary home */
    }
    if (isDirectory(dir)) return { dir, browserDir: path.join(dir, DIR_BROWSER) };
  }

  const home = path.join(appData, HOME_DIR_NAME);
  const legacy = path.join(appData, LEGACY_HOME_DIR_NAME);
  const tidy: AppHome = { dir: home, browserDir: path.join(home, DIR_BROWSER) };

  if (isDirectory(home) || !isDirectory(legacy)) return tidy;

  if (!isDirectoryInUse(legacy, platform)) {
    try {
      fs.renameSync(legacy, home);
      return { ...tidy, migratedFrom: legacy };
    } catch {
      // Two copies started at once can both get here, and one of them has
      // already done it. That one's result is the truth.
      if (isDirectory(home)) return tidy;
    }
  }

  // Held open by something. Used exactly as the older build left it — the same
  // directory, the browser's files where they were — so that a copy of that
  // build still running in it finds nothing moved, and this start loses the
  // single-instance lock to it instead of opening a second, empty launcher.
  return { dir: legacy, browserDir: legacy, legacyInUse: legacy };
}

/**
 * Put the browser's files in the browser's directory.
 *
 * The first time a home is seen without one, everything at its top level that
 * is not the launcher's is moved into it. That is how a home inherited from an
 * older build — which let Chromium scatter its files beside the profiles — is
 * tidied without anybody keeping a list of Chromium's file names: the
 * launcher's own list is the short one, and whatever is not on it goes. Moving
 * rather than deleting keeps what the browser remembered, dismissed
 * announcements and the Microsoft sign-in among it.
 *
 * Once, by construction: afterwards the directory exists and this returns at
 * its first line.
 */
export function fileBrowserDataAway(home: AppHome): void {
  if (home.browserDir === home.dir) return;
  if (isDirectory(home.browserDir)) return;

  fs.mkdirSync(home.browserDir, { recursive: true });

  let entries: string[];
  try {
    entries = fs.readdirSync(home.dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (LAUNCHER_ENTRIES.has(entry) || isLauncherSidecar(entry)) continue;
    try {
      fs.renameSync(path.join(home.dir, entry), path.join(home.browserDir, entry));
    } catch {
      /* held open by something; it stays where it is and nothing reads it */
    }
  }
}

/**
 * Bring the log and the crash reports to the data root.
 *
 * They used to be pinned to the home whatever the data did, and the effect was
 * the opposite of the intent: someone who moved their data to another drive
 * found the folder they had left still holding files, and "open the logs"
 * opening it. They follow the data now, so an install whose data had already
 * moved has them in the wrong place once — and this carries them over.
 *
 * A file already at the destination is kept and the arriving one is given a
 * name beside it: these are diagnostics, and losing either copy to tidy up
 * would be the wrong trade.
 */
export function carryDiagnostics(homeDir: string, rootDir: string): void {
  if (path.resolve(homeDir) === path.resolve(rootDir)) return;

  for (const name of [DIR_LOGS, DIR_CRASH_REPORTS]) {
    const from = path.join(homeDir, name);
    if (!isDirectory(from)) continue;
    const to = path.join(rootDir, name);

    try {
      fs.mkdirSync(to, { recursive: true });
      for (const file of fs.readdirSync(from)) {
        const source = path.join(from, file);
        if (!fs.statSync(source).isFile()) continue;
        let target = path.join(to, file);
        if (fs.existsSync(target)) target = path.join(to, `earlier-${file}`);
        try {
          fs.renameSync(source, target);
        } catch {
          // Another volume, which is the usual reason the data moved at all.
          fs.copyFileSync(source, target);
          fs.rmSync(source, { force: true });
        }
      }
      fs.rmdirSync(from);
    } catch {
      /* whatever could not be carried stays readable where it was */
    }
  }
}
