// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import path from 'node:path';
import { app } from 'electron';
import {
  DIR_BROWSER,
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
import { isSafeFileName } from '../../shared/manifest-schema';

/**
 * Centralized path resolver for all launcher data directories.
 *
 * The base is `data-root.ts`, not `app.getPath('userData')` directly, because
 * the root is movable — see that file. Everything here is a getter for the same
 * reason: they are read after the root is known, not baked in at import.
 *
 * The log and the crash reports are under the root with everything else. They
 * were once pinned to the home, so that they could still be read on a day the
 * drive holding the games was not plugged in — and that needs no pinning: with
 * the configured root unreachable the home stands in as the root, so they land
 * there anyway. What the pinning did do was leave a folder of the launcher's
 * files behind every time the data moved, with the "open logs" button pointing
 * at the place the player had just moved away from.
 */
function getDataRoot(): string {
  return dataRoot();
}

/** The launcher's home: Electron's `userData`. See `app-home.ts`. */
function getHome(): string {
  return app.getPath('userData');
}

/**
 * A profile id on its way to becoming a directory name, checked rather than
 * trusted.
 *
 * Every builder below joins the id straight onto the data root, and ids arrive
 * over IPC: nothing between the renderer and here parses them, because
 * `profileSchema` only ever sees a whole profile and the handlers take the id as
 * a bare string. An id of `../../..` therefore used to resolve to a path outside
 * the launcher's data entirely, and `discardOrphanedProfile` would then delete
 * it recursively.
 *
 * Ids the launcher makes are UUIDs, but this is deliberately the weaker rule —
 * "a single path component" — so that a directory adopted from an older build,
 * or one restored by hand, is still reachable. Containment is what matters, and
 * a name with no separator, no `.`/`..` and no NUL cannot leave the directory it
 * is joined to.
 */
function segment(profileId: string): string {
  if (typeof profileId !== 'string' || !isSafeFileName(profileId)) {
    throw new Error(`Not a profile id: ${JSON.stringify(profileId)}`);
  }
  return profileId;
}

export const paths = {
  /** Root data directory */
  get root() {
    return getDataRoot();
  },

  /**
   * The launcher's home. The same directory as `root` until the data is moved;
   * after that, the pointer to it and the embedded browser's files.
   */
  get home() {
    return getHome();
  },

  /** browser/ — the embedded browser's own files. In the home, never the root. */
  get browserDir() {
    return path.join(getHome(), DIR_BROWSER);
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

  /**
   * cache/libraries/ — the game's jars and the loaders', in the Maven layout.
   * A Forge or NeoForge installer pointed at `cacheDir` writes into this folder
   * of its own accord, which is why it is under the cache and named this.
   */
  get librariesDir() {
    return path.join(getDataRoot(), DIR_CACHE, 'libraries');
  },

  /** logs/ — application logs (electron-log). */
  get logsDir() {
    return path.join(getDataRoot(), DIR_LOGS);
  },

  /**
   * crash-reports/ — one file per crash, written for a human to attach to a bug
   * report. Not to be confused with the `crash-reports/` Minecraft writes inside
   * each profile's game directory; these quote from those.
   */
  get crashReportsDir() {
    return path.join(getDataRoot(), DIR_CRASH_REPORTS);
  },

  /**
   * Is `target` inside one of the launcher's own directories?
   *
   * `system:open-path` runs whatever the OS associates with what it is given,
   * so it is confined to these two: the data root, and the home it has moved
   * away from, which is still the launcher's and is still shown in Settings.
   */
  isInsideLauncherData(target: string): boolean {
    if (typeof target !== 'string' || target === '') return false;
    const resolved = path.resolve(target);
    return [paths.root, paths.home].some((base) => {
      const relative = path.relative(base, resolved);
      return (
        relative === '' ||
        (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
      );
    });
  },

  /** Per-profile directory */
  profileDir(profileId: string) {
    return path.join(getDataRoot(), DIR_PROFILES, segment(profileId));
  },

  /** Per-profile .minecraft game directory */
  profileGameDir(profileId: string) {
    return path.join(getDataRoot(), DIR_PROFILES, segment(profileId), '.minecraft');
  },

  /** Per-profile mods directory */
  profileModsDir(profileId: string) {
    return path.join(getDataRoot(), DIR_PROFILES, segment(profileId), '.minecraft', 'mods');
  },

  /** Per-profile installed.lock */
  profileLockFile(profileId: string) {
    return path.join(getDataRoot(), DIR_PROFILES, segment(profileId), 'installed.lock');
  },

  /** Per-profile manifest sync state (ETag, last sync result) */
  profileSyncStateFile(profileId: string) {
    return path.join(getDataRoot(), DIR_PROFILES, segment(profileId), 'sync-state.json');
  },

  /**
   * Last manifest body that validated, verbatim. Kept so a 304 has something to
   * reconcile against and so a sync without network can still work.
   */
  profileManifestCacheFile(profileId: string) {
    return path.join(getDataRoot(), DIR_PROFILES, segment(profileId), 'manifest.cache.json');
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
    return path.join(getDataRoot(), DIR_PROFILES, segment(profileId), 'backups');
  },

  /** Per-profile shaderpacks directory */
  profileShadersDir(profileId: string) {
    return path.join(getDataRoot(), DIR_PROFILES, segment(profileId), '.minecraft', 'shaderpacks');
  },

  /** Per-profile resourcepacks directory */
  profileResourcePacksDir(profileId: string) {
    return path.join(
      getDataRoot(),
      DIR_PROFILES,
      segment(profileId),
      '.minecraft',
      'resourcepacks',
    );
  },
};
