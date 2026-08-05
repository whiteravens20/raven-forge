import { app, ipcMain, dialog, shell } from 'electron';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from './logger';
import { getMainWindow } from './window';
import { getSettings, updateSettings, resetSettings } from '../core/config/settings-manager';
import { applyProxySettings } from '../core/net/proxy';
import { paths } from '../core/config/paths';
import { fetchNews, fetchAnnouncements } from '../core/news/news-fetcher';
import {
  getAllProfiles,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  duplicateProfile,
  exportProfile,
  importProfile,
  summarizeProfileFiles,
  listOrphanedProfiles,
  adoptOrphanedProfile,
  discardOrphanedProfile,
} from '../core/profiles/profile-manager';
import {
  setProfileIcon,
  clearProfileIcon,
  getProfileIconDataUrl,
} from '../core/profiles/profile-icon';
import { getProfileSyncStatus } from '../core/mods/mod-sync';
import {
  getInstalledMods,
  syncManifest,
  installModFromSearch,
  installModFromFile,
  uninstallMod,
  toggleModEnabled,
} from '../core/mods/mod-sync';
import { searchMods, getSearchFacets } from '../core/mods/modrinth-api';
import { planModInstall, planContentInstall } from '../core/mods/compatibility';
import { listCataloguePacks } from '../core/packs/catalogue';
import {
  importMrpack,
  createProfileFromManifest,
  createProfileFromUrl,
} from '../core/packs/pack-installer';
import { getShaderLoaderState, installShaderLoader } from '../core/mods/shader-loader';
import {
  listContent,
  installContent,
  removeContent,
  reorderResourcePacks,
} from '../core/mods/content-manager';
import { checkForUpdates, downloadUpdate, quitAndInstall } from '../core/updater/launcher-updater';
import { verifyProfileManifest } from '../core/updater/manifest-verify';
import {
  getJavaInstallations,
  ensureJavaVersion,
  detectSystemJava,
} from '../core/java/java-manager';
import {
  installLoader,
  getLoaderVersions,
  isLoaderInstalled,
} from '../core/modloader/loader-manager';
import { launchGame, killGame, isGameRunning, getLogTail } from '../core/minecraft/game-launcher';
import { getVersionManifest } from '../core/minecraft/version-manifest';
import { cancelJob } from '../core/util/cancellation';
import {
  loginMicrosoft,
  loginOffline,
  logoutAccount,
  getAuthState,
  setActiveAccount,
  refreshAccount,
} from '../core/auth/microsoft-auth';
import type {
  IpcResult,
  IpcErrorCode,
  GlobalSettings,
  TrustedKey,
  SystemInfo,
  ShaderLoaderResult,
} from '../shared/ipc-types';
import { AuthServersUnreachableError } from '../core/auth/auth-errors';

/** Log tail limits — enough to diagnose a crash, small enough to ship over IPC. */
const LOG_TAIL_DEFAULT_LINES = 500;
const LOG_TAIL_MAX_LINES = 5000;
const LOG_TAIL_MAX_BYTES = 1024 * 1024;

function ok<T>(data: T): IpcResult<T> {
  return { success: true, data };
}

function fail<T>(error: string, code?: IpcErrorCode): IpcResult<T> {
  return { success: false, error, ...(code ? { code } : {}) };
}

/**
 * The message of a thrown value, without the `Error: ` that template-stringing
 * an Error prepends. These strings are shown to the user verbatim, and
 * "Login failed: Error: Microsoft login is not configured" reads like a bug.
 */
function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Register all IPC handlers. Called once during app startup.
 */
export function registerAllIpcHandlers(): void {
  // ── Window Controls ──────────────────────────────────────
  ipcMain.handle('window:minimize', () => {
    getMainWindow()?.minimize();
  });
  ipcMain.handle('window:maximize', () => {
    const win = getMainWindow();
    if (win?.isMaximized()) {
      win.unmaximize();
    } else {
      win?.maximize();
    }
  });
  ipcMain.handle('window:close', () => {
    getMainWindow()?.close();
  });
  ipcMain.handle('window:is-maximized', () => {
    return getMainWindow()?.isMaximized() ?? false;
  });

  // ── System ───────────────────────────────────────────────
  ipcMain.handle('system:get-info', async () => {
    const info: SystemInfo = {
      launcherVersion: app.getVersion(),
      platform: process.platform as SystemInfo['platform'],
      arch: process.arch,
      totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
      freeMemoryMb: Math.round(os.freemem() / 1024 / 1024),
      dataDirectory: paths.root,
    };
    return ok(info);
  });
  ipcMain.handle('system:open-path', async (_event, targetPath: string) => {
    try {
      await shell.openPath(targetPath);
      return ok(undefined);
    } catch (err) {
      return fail(`Failed to open path: ${reason(err)}`);
    }
  });
  ipcMain.handle('system:open-url', async (_event, url: string) => {
    // Only allow https:// and http:// URLs for security
    if (!url.startsWith('https://') && !url.startsWith('http://')) {
      return fail('Only HTTP/HTTPS URLs are allowed');
    }
    try {
      await shell.openExternal(url);
      return ok(undefined);
    } catch (err) {
      return fail(`Failed to open URL: ${reason(err)}`);
    }
  });
  ipcMain.handle('system:select-directory', async () => {
    const win = getMainWindow();
    if (!win) return fail('No window available');
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return ok(null);
    return ok(result.filePaths[0]);
  });
  ipcMain.handle(
    'system:select-file',
    async (_event, filters?: { name: string; extensions: string[] }[]) => {
      const win = getMainWindow();
      if (!win) return fail('No window available');
      const result = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: filters ?? [{ name: 'All Files', extensions: ['*'] }],
      });
      if (result.canceled || result.filePaths.length === 0) return ok(null);
      return ok(result.filePaths[0]);
    },
  );
  ipcMain.handle('system:get-logs-path', () => {
    return ok(paths.logsDir);
  });
  ipcMain.handle('system:read-log', async (_event, lines?: number) => {
    const wanted = Math.min(Math.max(lines ?? LOG_TAIL_DEFAULT_LINES, 1), LOG_TAIL_MAX_LINES);
    const file = path.join(paths.logsDir, 'main.log');
    let handle;
    try {
      handle = await fs.open(file, 'r');
      const { size } = await handle.stat();
      // electron-log rotates at 5 MB; only the tail is ever interesting, so
      // read a bounded window from the end rather than the whole file.
      const start = Math.max(0, size - LOG_TAIL_MAX_BYTES);
      const buffer = Buffer.alloc(size - start);
      await handle.read(buffer, 0, buffer.length, start);

      const text = buffer.toString('utf-8');
      const all = text.split(/\r?\n/);
      // A non-zero offset almost certainly lands mid-line; drop that fragment.
      if (start > 0) all.shift();
      return ok(all.filter((l) => l.length > 0).slice(-wanted));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return ok([]);
      return fail(`Failed to read log: ${reason(err)}`);
    } finally {
      await handle?.close();
    }
  });

  // ── Settings ─────────────────────────────────────────────
  ipcMain.handle('settings:get', async () => {
    try {
      return ok(await getSettings());
    } catch (err) {
      return fail(`Failed to load settings: ${reason(err)}`);
    }
  });
  ipcMain.handle('settings:update', async (_event, updates: Partial<GlobalSettings>) => {
    try {
      const settings = await updateSettings(updates);
      await applyProxySettings(settings);
      return ok(settings);
    } catch (err) {
      return fail(`Failed to update settings: ${reason(err)}`);
    }
  });
  ipcMain.handle('settings:reset', async () => {
    try {
      return ok(await resetSettings());
    } catch (err) {
      return fail(`Failed to reset settings: ${reason(err)}`);
    }
  });
  ipcMain.handle('settings:add-trusted-key', async (_event, key: TrustedKey) => {
    try {
      const settings = await getSettings();
      const exists = settings.trustedPublicKeys.some((k) => k.publicKey === key.publicKey);
      if (exists) return fail('Key already exists');
      await updateSettings({
        trustedPublicKeys: [...settings.trustedPublicKeys, key],
      });
      return ok(undefined);
    } catch (err) {
      return fail(`Failed to add trusted key: ${reason(err)}`);
    }
  });
  ipcMain.handle('settings:remove-trusted-key', async (_event, publicKey: string) => {
    try {
      const settings = await getSettings();
      await updateSettings({
        trustedPublicKeys: settings.trustedPublicKeys.filter((k) => k.publicKey !== publicKey),
      });
      return ok(undefined);
    } catch (err) {
      return fail(`Failed to remove trusted key: ${reason(err)}`);
    }
  });

  // ── News & Announcements ────────────────────────────────
  ipcMain.handle('news:get', async () => {
    try {
      return ok(await fetchNews());
    } catch (err) {
      return fail(`Failed to fetch news: ${reason(err)}`);
    }
  });
  ipcMain.handle('news:refresh', async () => {
    try {
      return ok(await fetchNews(true));
    } catch (err) {
      return fail(`Failed to refresh news: ${reason(err)}`);
    }
  });
  ipcMain.handle('announcements:get', async () => {
    try {
      return ok(await fetchAnnouncements());
    } catch (err) {
      return fail(`Failed to fetch announcements: ${reason(err)}`);
    }
  });
  ipcMain.handle('announcements:refresh', async () => {
    try {
      return ok(await fetchAnnouncements(true));
    } catch (err) {
      return fail(`Failed to refresh announcements: ${reason(err)}`);
    }
  });
  ipcMain.handle('announcements:dismiss', async (_event, _id: string) => {
    // Dismissal is handled client-side (stored in localStorage / zustand)
    return ok(undefined);
  });

  // ── Auth ─────────────────────────────────────────────────
  ipcMain.handle('auth:login-microsoft', async () => {
    try {
      return ok(await loginMicrosoft());
    } catch (err) {
      log.error('Microsoft login failed:', err);
      return fail(`Login failed: ${reason(err)}`);
    }
  });
  ipcMain.handle('auth:login-offline', async (_event, username: string) => {
    try {
      return ok(await loginOffline(username));
    } catch (err) {
      return fail(`Offline login failed: ${reason(err)}`);
    }
  });
  ipcMain.handle('auth:logout', async (_event, accountId: string) => {
    try {
      await logoutAccount(accountId);
      return ok(undefined);
    } catch (err) {
      return fail(`Logout failed: ${reason(err)}`);
    }
  });
  ipcMain.handle('auth:get-state', async () => {
    try {
      return ok(await getAuthState());
    } catch (err) {
      return fail(`Failed to get auth state: ${reason(err)}`);
    }
  });
  ipcMain.handle('auth:set-active', async (_event, accountId: string) => {
    try {
      await setActiveAccount(accountId);
      return ok(undefined);
    } catch (err) {
      return fail(`Failed to set active account: ${reason(err)}`);
    }
  });
  ipcMain.handle('auth:refresh', async (_event, accountId: string) => {
    try {
      return ok(await refreshAccount(accountId));
    } catch (err) {
      return fail(`Token refresh failed: ${reason(err)}`);
    }
  });

  // ── Profiles ─────────────────────────────────────────────
  ipcMain.handle('profiles:get-all', async () => {
    try {
      return ok(await getAllProfiles());
    } catch (err) {
      return fail(`Failed to get profiles: ${reason(err)}`);
    }
  });
  ipcMain.handle('profiles:get', async (_event, profileId: string) => {
    try {
      return ok(await getProfile(profileId));
    } catch (err) {
      return fail(`Failed to get profile: ${reason(err)}`);
    }
  });
  ipcMain.handle('profiles:create', async (_event, profile) => {
    try {
      return ok(await createProfile(profile));
    } catch (err) {
      return fail(`Failed to create profile: ${reason(err)}`);
    }
  });
  ipcMain.handle('profiles:update', async (_event, profileId: string, updates) => {
    try {
      return ok(await updateProfile(profileId, updates));
    } catch (err) {
      return fail(`Failed to update profile: ${reason(err)}`);
    }
  });
  ipcMain.handle('profiles:delete', async (_event, profileId: string, deleteFiles: boolean) => {
    try {
      await deleteProfile(profileId, deleteFiles);
      return ok(undefined);
    } catch (err) {
      return fail(`Failed to delete profile: ${reason(err)}`);
    }
  });
  ipcMain.handle('profiles:get-file-summary', async (_event, profileId: string) => {
    try {
      return ok(await summarizeProfileFiles(profileId));
    } catch (err) {
      return fail(`Failed to inspect profile files: ${reason(err)}`);
    }
  });
  ipcMain.handle('profiles:list-orphaned', async () => {
    try {
      return ok(await listOrphanedProfiles());
    } catch (err) {
      return fail(`Failed to list kept profile files: ${reason(err)}`);
    }
  });
  ipcMain.handle('profiles:adopt-orphaned', async (_event, profileId: string) => {
    try {
      return ok(await adoptOrphanedProfile(profileId));
    } catch (err) {
      return fail(`Failed to restore that profile: ${reason(err)}`);
    }
  });
  ipcMain.handle('profiles:discard-orphaned', async (_event, profileId: string) => {
    try {
      await discardOrphanedProfile(profileId);
      return ok(undefined);
    } catch (err) {
      return fail(`Failed to delete those files: ${reason(err)}`);
    }
  });
  ipcMain.handle('profiles:duplicate', async (_event, profileId: string) => {
    try {
      return ok(await duplicateProfile(profileId));
    } catch (err) {
      return fail(`Failed to duplicate profile: ${reason(err)}`);
    }
  });
  ipcMain.handle('profiles:export', async (_event, profileId: string) => {
    try {
      return ok(await exportProfile(profileId));
    } catch (err) {
      return fail(`Failed to export profile: ${reason(err)}`);
    }
  });
  ipcMain.handle('profiles:import', async (_event, json: string) => {
    try {
      return ok(await importProfile(json));
    } catch (err) {
      return fail(`Failed to import profile: ${reason(err)}`);
    }
  });
  ipcMain.handle('profiles:get-sync-status', async (_event, profileId: string) => {
    try {
      return ok(await getProfileSyncStatus(profileId));
    } catch (err) {
      return fail(`Failed to get sync status: ${reason(err)}`);
    }
  });
  ipcMain.handle(
    'profiles:set-icon',
    async (_event, profileId: string, sourcePath: string | null) => {
      try {
        const profile = sourcePath
          ? await setProfileIcon(profileId, sourcePath)
          : await clearProfileIcon(profileId);
        return ok(profile);
      } catch (err) {
        return fail(`Failed to set icon: ${reason(err)}`);
      }
    },
  );
  ipcMain.handle('profiles:get-icon', async (_event, profileId: string) => {
    try {
      return ok(await getProfileIconDataUrl(profileId));
    } catch (err) {
      return fail(`Failed to read icon: ${reason(err)}`);
    }
  });

  // ── Packs ────────────────────────────────────────────────
  ipcMain.handle('packs:list-catalogue', async () => {
    try {
      return ok(await listCataloguePacks());
    } catch (err) {
      return fail(`Could not load the pack list: ${reason(err)}`);
    }
  });
  ipcMain.handle('packs:create-from-manifest', async (_event, url: string) => {
    try {
      return ok(await createProfileFromManifest(url));
    } catch (err) {
      return fail(`Could not create a profile from that manifest: ${reason(err)}`);
    }
  });
  ipcMain.handle('packs:create-from-url', async (_event, url: string) => {
    try {
      return ok(await createProfileFromUrl(url));
    } catch (err) {
      return fail(`Could not create a profile from that link: ${reason(err)}`);
    }
  });
  ipcMain.handle('packs:import-mrpack', async (_event, filePath: string) => {
    try {
      return ok(await importMrpack(filePath));
    } catch (err) {
      return fail(`Could not import that pack: ${reason(err)}`);
    }
  });

  // ── Mods ─────────────────────────────────────────────────
  ipcMain.handle('mods:get-installed', async (_event, profileId: string) => {
    try {
      return ok(await getInstalledMods(profileId));
    } catch (err) {
      return fail(`Failed to get installed mods: ${reason(err)}`);
    }
  });
  ipcMain.handle('mods:sync-manifest', async (_event, profileId: string) => {
    try {
      await syncManifest(profileId);
      return ok(undefined);
    } catch (err) {
      return fail(`Mod sync failed: ${reason(err)}`);
    }
  });
  ipcMain.handle('mods:install-from-search', async (_event, profileId, mod, version) => {
    try {
      return ok(await installModFromSearch(profileId, mod, version));
    } catch (err) {
      return fail(`Failed to install mod: ${reason(err)}`);
    }
  });
  ipcMain.handle('mods:check-install', async (_event, profileId, mod) => {
    try {
      const profile = await getProfile(profileId);
      if (!profile) return fail(`Profile ${profileId} not found`);
      return ok(await planModInstall(profile, mod, await getInstalledMods(profileId)));
    } catch (err) {
      return fail(`Could not check compatibility: ${reason(err)}`);
    }
  });
  ipcMain.handle('mods:install-from-file', async (_event, profileId: string, filePath: string) => {
    try {
      return ok(await installModFromFile(profileId, filePath));
    } catch (err) {
      return fail(`Failed to install mod from file: ${reason(err)}`);
    }
  });
  ipcMain.handle('mods:uninstall', async (_event, profileId: string, modId: string) => {
    try {
      await uninstallMod(profileId, modId);
      return ok(undefined);
    } catch (err) {
      return fail(`Failed to uninstall mod: ${reason(err)}`);
    }
  });
  ipcMain.handle(
    'mods:toggle-enabled',
    async (_event, profileId: string, modId: string, enabled: boolean) => {
      try {
        await toggleModEnabled(profileId, modId, enabled);
        return ok(undefined);
      } catch (err) {
        return fail(`Failed to toggle mod: ${reason(err)}`);
      }
    },
  );
  ipcMain.handle('mods:search', async (_event, filters) => {
    try {
      return ok(await searchMods(filters));
    } catch (err) {
      return fail(`Mod search failed: ${reason(err)}`);
    }
  });
  ipcMain.handle('mods:get-facets', async (_event, projectType) => {
    try {
      return ok(await getSearchFacets(projectType));
    } catch (err) {
      return fail(`Could not load filters: ${reason(err)}`);
    }
  });

  // ── Shaders & Resource Packs ─────────────────────────────
  ipcMain.handle('content:get-shaders', async (_event, profileId: string) => {
    try {
      return ok(await listContent('shaders', profileId));
    } catch (err) {
      return fail(`Failed to list shaders: ${reason(err)}`);
    }
  });
  ipcMain.handle('content:get-resourcepacks', async (_event, profileId: string) => {
    try {
      return ok(await listContent('resourcepacks', profileId));
    } catch (err) {
      return fail(`Failed to list resource packs: ${reason(err)}`);
    }
  });
  ipcMain.handle(
    'content:install-shader',
    async (_event, profileId: string, source: string, version?: string) => {
      try {
        await installContent('shaders', profileId, source, version);
        return ok(undefined);
      } catch (err) {
        return fail(`Failed to install shader: ${reason(err)}`);
      }
    },
  );
  ipcMain.handle('content:check-install', async (_event, profileId, item) => {
    try {
      const profile = await getProfile(profileId);
      if (!profile) return fail(`Profile ${profileId} not found`);
      return ok(await planContentInstall(profile, item));
    } catch (err) {
      return fail(`Could not check compatibility: ${reason(err)}`);
    }
  });
  ipcMain.handle('content:get-shader-loader-state', async (_event, profileId: string) => {
    try {
      const profile = await getProfile(profileId);
      if (!profile) return fail(`Profile ${profileId} not found`);
      return ok(await getShaderLoaderState(profileId, profile.minecraftVersion, profile.modLoader));
    } catch (err) {
      return fail(`Failed to check the shader loader: ${reason(err)}`);
    }
  });
  ipcMain.handle(
    'content:install-shader-loader',
    async (_event, profileId: string, projectId: string) => {
      try {
        const profile = await getProfile(profileId);
        if (!profile) return fail(`Profile ${profileId} not found`);
        return ok(
          await installShaderLoader(
            profileId,
            projectId,
            profile.minecraftVersion,
            profile.modLoader,
          ),
        );
      } catch (err) {
        // Reported, not thrown: the shader pack itself is already installed, and
        // a network hiccup fetching Iris is not a reason to call that a failure.
        log.warn('Shader loader install failed:', err);
        return ok<ShaderLoaderResult>({ status: 'failed', error: reason(err) });
      }
    },
  );
  ipcMain.handle(
    'content:install-resourcepack',
    async (_event, profileId: string, source: string, version?: string) => {
      try {
        await installContent('resourcepacks', profileId, source, version);
        return ok(undefined);
      } catch (err) {
        return fail(`Failed to install resource pack: ${reason(err)}`);
      }
    },
  );
  ipcMain.handle('content:remove-shader', async (_event, profileId: string, id: string) => {
    try {
      await removeContent('shaders', profileId, id);
      return ok(undefined);
    } catch (err) {
      return fail(`Failed to remove shader: ${reason(err)}`);
    }
  });
  ipcMain.handle('content:remove-resourcepack', async (_event, profileId: string, id: string) => {
    try {
      await removeContent('resourcepacks', profileId, id);
      return ok(undefined);
    } catch (err) {
      return fail(`Failed to remove resource pack: ${reason(err)}`);
    }
  });
  ipcMain.handle(
    'content:reorder-resourcepacks',
    async (_event, profileId: string, orderedIds: string[]) => {
      try {
        await reorderResourcePacks(profileId, orderedIds);
        return ok(undefined);
      } catch (err) {
        return fail(`Failed to reorder resource packs: ${reason(err)}`);
      }
    },
  );

  // ── Java ─────────────────────────────────────────────────
  ipcMain.handle('java:get-installations', async () => {
    try {
      return ok(await getJavaInstallations());
    } catch (err) {
      return fail(`Failed to get Java installations: ${reason(err)}`);
    }
  });
  ipcMain.handle('java:ensure-version', async (_event, majorVersion: number) => {
    try {
      return ok(await ensureJavaVersion(majorVersion));
    } catch (err) {
      return fail(`Failed to ensure Java version: ${reason(err)}`);
    }
  });
  ipcMain.handle('java:detect-system', async () => {
    try {
      return ok(await detectSystemJava());
    } catch (err) {
      return fail(`Failed to detect system Java: ${reason(err)}`);
    }
  });

  // ── Mod Loaders ──────────────────────────────────────────
  ipcMain.handle('loaders:install', async (_event, loader, loaderVersion, mcVersion) => {
    try {
      await installLoader(loader, loaderVersion, mcVersion);
      return ok(undefined);
    } catch (err) {
      return fail(`Failed to install loader: ${reason(err)}`);
    }
  });
  ipcMain.handle('loaders:get-versions', async (_event, loader, mcVersion) => {
    try {
      return ok(await getLoaderVersions(loader, mcVersion));
    } catch (err) {
      return fail(`Failed to get loader versions: ${reason(err)}`);
    }
  });
  ipcMain.handle('loaders:is-installed', async (_event, loader, loaderVersion, mcVersion) => {
    try {
      return ok(await isLoaderInstalled(loader, loaderVersion, mcVersion));
    } catch (err) {
      return fail(`Failed to check loader: ${reason(err)}`);
    }
  });

  // ── Game Launch ──────────────────────────────────────────
  ipcMain.handle('game:launch', async (_event, options) => {
    try {
      await launchGame(options);
      return ok(undefined);
    } catch (err) {
      // Tagged, not just worded: the renderer offers "launch offline" for this
      // one and nothing for a rejected login, and matching on message text
      // would break the first time anyone rewords or translates it.
      if (err instanceof AuthServersUnreachableError) {
        return fail(`Failed to launch game: ${reason(err)}`, 'AUTH_UNREACHABLE');
      }
      return fail(`Failed to launch game: ${reason(err)}`);
    }
  });
  ipcMain.handle('game:kill', async (_event, profileId: string) => {
    try {
      await killGame(profileId);
      return ok(undefined);
    } catch (err) {
      return fail(`Failed to kill game: ${reason(err)}`);
    }
  });
  ipcMain.handle('game:is-running', async (_event, profileId: string) => {
    try {
      return ok(await isGameRunning(profileId));
    } catch (err) {
      return fail(`Failed to check game status: ${reason(err)}`);
    }
  });
  ipcMain.handle('game:get-log-tail', async (_event, profileId: string, lines?: number) => {
    try {
      return ok(getLogTail(profileId, lines));
    } catch (err) {
      return fail(`Failed to read game log: ${reason(err)}`);
    }
  });
  ipcMain.handle('game:cancel', async (_event, profileId: string) => {
    try {
      return ok(cancelJob(profileId));
    } catch (err) {
      return fail(`Failed to cancel: ${reason(err)}`);
    }
  });
  ipcMain.handle('game:get-versions', async (_event, includeSnapshots?: boolean) => {
    try {
      const manifest = await getVersionManifest();
      const wanted = includeSnapshots ? ['release', 'snapshot'] : ['release'];
      // Mojang already orders newest first; keep that rather than sorting
      // version strings, which no comparator gets right across MC's history.
      return ok(manifest.versions.filter((v) => wanted.includes(v.type)).map((v) => v.id));
    } catch (err) {
      return fail(`Failed to list Minecraft versions: ${reason(err)}`);
    }
  });

  // ── Updater ──────────────────────────────────────────────
  ipcMain.handle('updater:check', async () => {
    try {
      return ok(await checkForUpdates());
    } catch (err) {
      return fail(`Update check failed: ${reason(err)}`);
    }
  });
  ipcMain.handle('updater:download', async () => {
    try {
      await downloadUpdate();
      return ok(undefined);
    } catch (err) {
      return fail(`Update download failed: ${reason(err)}`);
    }
  });
  ipcMain.handle('updater:install', async () => {
    quitAndInstall();
    return ok(undefined);
  });

  // ── Manifest Verification ────────────────────────────────
  ipcMain.handle('manifest:verify', async (_event, profileId: string) => {
    try {
      return ok(await verifyProfileManifest(profileId));
    } catch (err) {
      return fail(`Manifest verification failed: ${reason(err)}`);
    }
  });

  log.info(`Registered IPC handlers for all channels.`);
}
