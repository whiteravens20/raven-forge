import path from 'node:path';
import { app } from 'electron';
import {
  DIR_PROFILES,
  DIR_LOADERS,
  DIR_JAVA,
  DIR_CACHE,
  DIR_LOGS,
  DIR_CRASH_REPORTS,
  FILE_SETTINGS,
  FILE_PROFILES,
} from '../../shared/constants';
import { dataRoot } from './data-root';

/**
 * Centralized path resolver for all launcher data directories.
 *
 * The base is `data-root.ts`, not `app.getPath('userData')` directly, because
 * the root is movable — see that file. Everything here is a getter for the same
 * reason: they are read after the root is known, not baked in at import.
 *
 * Two things stay behind in `userData` whatever the root is doing, and both are
 * diagnostics rather than data: the log the app is writing while it runs, which
 * on Windows cannot be moved out from under its own open handle, and the crash
 * reports. Pinning them also means the log viewer and the crash reporter still
 * work on the day the drive holding the games is not plugged in — which is
 * exactly the day someone needs to read them.
 */
function getDataRoot(): string {
  return dataRoot();
}

/** Electron's own per-user directory. Diagnostics live here, not under the root. */
function getDiagnosticsRoot(): string {
  return app.getPath('userData');
}

export const paths = {
  /** Root data directory */
  get root() {
    return getDataRoot();
  },

  /** settings.json */
  get settings() {
    return path.join(getDataRoot(), FILE_SETTINGS);
  },

  /** profiles.json — list of all profiles */
  get profilesIndex() {
    return path.join(getDataRoot(), FILE_PROFILES);
  },

  /** profiles/ — each profile gets a subdirectory */
  get profilesDir() {
    return path.join(getDataRoot(), DIR_PROFILES);
  },

  /** loaders/ — cached mod loader installers */
  get loadersDir() {
    return path.join(getDataRoot(), DIR_LOADERS);
  },

  /** java/ — managed Adoptium JRE installations */
  get javaDir() {
    return path.join(getDataRoot(), DIR_JAVA);
  },

  /** cache/ — ETag cache, manifest cache, etc. */
  get cacheDir() {
    return path.join(getDataRoot(), DIR_CACHE);
  },

  /** logs/ — application logs (electron-log). Pinned; see the note above. */
  get logsDir() {
    return path.join(getDiagnosticsRoot(), DIR_LOGS);
  },

  /**
   * crash-reports/ — one file per crash, written for a human to attach to a bug
   * report. Not to be confused with the `crash-reports/` Minecraft writes inside
   * each profile's game directory; these quote from those.
   */
  get crashReportsDir() {
    return path.join(getDiagnosticsRoot(), DIR_CRASH_REPORTS);
  },

  /**
   * Is `target` one of the launcher's own directories?
   *
   * `system:open-path` runs whatever the OS associates with what it is given,
   * so it is confined to these. All three are named because they stopped being
   * nested when the root became movable: move the data to another drive and the
   * logs and crash reports stay in `userData`, outside `root` — which silently
   * made "open the crash reports folder" a refusal.
   */
  isInsideLauncherData(target: string): boolean {
    if (typeof target !== 'string' || target === '') return false;
    const resolved = path.resolve(target);
    return [paths.root, paths.logsDir, paths.crashReportsDir].some((base) => {
      const relative = path.relative(base, resolved);
      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    });
  },

  /** Per-profile directory */
  profileDir(profileId: string) {
    return path.join(getDataRoot(), DIR_PROFILES, profileId);
  },

  /** Per-profile .minecraft game directory */
  profileGameDir(profileId: string) {
    return path.join(getDataRoot(), DIR_PROFILES, profileId, '.minecraft');
  },

  /** Per-profile mods directory */
  profileModsDir(profileId: string) {
    return path.join(getDataRoot(), DIR_PROFILES, profileId, '.minecraft', 'mods');
  },

  /** Per-profile installed.lock */
  profileLockFile(profileId: string) {
    return path.join(getDataRoot(), DIR_PROFILES, profileId, 'installed.lock');
  },

  /** Per-profile manifest sync state (ETag, last sync result) */
  profileSyncStateFile(profileId: string) {
    return path.join(getDataRoot(), DIR_PROFILES, profileId, 'sync-state.json');
  },

  /**
   * Last manifest body that validated, verbatim. Kept so a 304 has something to
   * reconcile against and so a sync without network can still work.
   */
  profileManifestCacheFile(profileId: string) {
    return path.join(getDataRoot(), DIR_PROFILES, profileId, 'manifest.cache.json');
  },

  /**
   * Per-profile world backups, one directory per backup.
   *
   * Inside the profile on purpose: a backup belongs to the profile it came from,
   * follows it around, and goes when it goes. What it protects against is the
   * launcher — a version change, a restore — and not a failing disk, which is a
   * different problem and needs somewhere else entirely.
   */
  profileBackupsDir(profileId: string) {
    return path.join(getDataRoot(), DIR_PROFILES, profileId, 'backups');
  },

  /** Per-profile shaderpacks directory */
  profileShadersDir(profileId: string) {
    return path.join(getDataRoot(), DIR_PROFILES, profileId, '.minecraft', 'shaderpacks');
  },

  /** Per-profile resourcepacks directory */
  profileResourcePacksDir(profileId: string) {
    return path.join(getDataRoot(), DIR_PROFILES, profileId, '.minecraft', 'resourcepacks');
  },
};
