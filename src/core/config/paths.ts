import path from 'node:path';
import { app } from 'electron';
import {
  DIR_PROFILES,
  DIR_LOADERS,
  DIR_JAVA,
  DIR_CACHE,
  DIR_LOGS,
  FILE_SETTINGS,
  FILE_PROFILES,
} from '../../shared/constants';

/**
 * Centralized path resolver for all launcher data directories.
 * Base: electron app.getPath('userData') → typically:
 *   Windows: %APPDATA%/Raven Forge Launcher
 *   Linux:   ~/.config/Raven Forge Launcher
 */
function getDataRoot(): string {
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

  /** logs/ — application logs (electron-log) */
  get logsDir() {
    return path.join(getDataRoot(), DIR_LOGS);
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

  /** Per-profile shaderpacks directory */
  profileShadersDir(profileId: string) {
    return path.join(getDataRoot(), DIR_PROFILES, profileId, '.minecraft', 'shaderpacks');
  },

  /** Per-profile resourcepacks directory */
  profileResourcePacksDir(profileId: string) {
    return path.join(getDataRoot(), DIR_PROFILES, profileId, '.minecraft', 'resourcepacks');
  },
};
