import { app, ipcMain, dialog, shell, type IpcMainInvokeEvent } from 'electron';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from './logger';
import { getMainWindow } from './window';
import { assertTrustedSender } from './security';
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
  resolveGameDir,
} from '../core/profiles/profile-manager';
import {
  setProfileIcon,
  clearProfileIcon,
  getProfileIconDataUrl,
} from '../core/profiles/profile-icon';
import { getProfileSyncStatus, getLastManifestVerification } from '../core/mods/mod-sync';
import {
  getInstalledMods,
  syncManifest,
  installModFromSearch,
  installModFromFile,
  uninstallMod,
  toggleModEnabled,
} from '../core/mods/mod-sync';
import { checkModUpdates, updateMods } from '../core/mods/mod-updates';
import { searchMods, getSearchFacets } from '../core/mods/modrinth-api';
import { planModInstall, planContentInstall } from '../core/mods/compatibility';
import { listCataloguePacks } from '../core/packs/catalogue';
import {
  importMrpack,
  createProfileFromManifest,
  createProfileFromUrl,
} from '../core/packs/pack-installer';
import { exportProfileAsMrpack } from '../core/packs/mrpack-export';
import { getShaderLoaderState, installShaderLoader } from '../core/mods/shader-loader';
import {
  listContent,
  installContent,
  removeContent,
  reorderResourcePacks,
} from '../core/mods/content-manager';
import { checkForUpdates, downloadUpdate, quitAndInstall } from '../core/updater/launcher-updater';
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
 * `ipcMain.handle`, with the caller checked first.
 *
 * Every channel goes through this rather than through `ipcMain.handle`
 * directly, so the guard is a property of the registration function instead of
 * something each of the eighty handlers has to remember.
 */
function handle(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: never[]) => unknown,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedSender(event, channel);
    return listener(event, ...(args as never[]));
  });
}

/** True when `target` is one of the launcher's own directories, or inside one. */
function isInsideLauncherData(target: string): boolean {
  if (typeof target !== 'string' || target === '') return false;
  const resolved = path.resolve(target);
  return [paths.root, paths.logsDir].some((root) => {
    const relative = path.relative(root, resolved);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  });
}

/**
 * Register all IPC handlers. Called once during app startup.
 */
export function registerAllIpcHandlers(): void {
  // ── Window Controls ──────────────────────────────────────
  handle('window:minimize', () => {
    getMainWindow()?.minimize();
  });
  handle('window:maximize', () => {
    const win = getMainWindow();
    if (win?.isMaximized()) {
      win.unmaximize();
    } else {
      win?.maximize();
    }
  });
  handle('window:close', () => {
    getMainWindow()?.close();
  });
  handle('window:is-maximized', () => {
    return getMainWindow()?.isMaximized() ?? false;
  });

  // ── System ───────────────────────────────────────────────
  handle('system:get-info', async () => {
    const info: SystemInfo = {
      launcherVersion: app.getVersion(),
      platform: process.platform as SystemInfo['platform'],
      arch: process.arch,
      totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
      freeMemoryMb: Math.round(os.freemem() / 1024 / 1024),
      dataDirectory: paths.root,
      crashReportsDirectory: paths.crashReportsDir,
    };
    return ok(info);
  });
  handle('system:open-path', async (_event, targetPath: string) => {
    // `shell.openPath` runs whatever the OS associates with the target — an
    // `.exe` or `.bat` on Windows, a `.desktop` entry on Linux — so an
    // unrestricted one is a way to execute an arbitrary file by asking the
    // renderer nicely. Every real caller passes a directory the main process
    // itself produced, so confining it to those costs nothing.
    if (!isInsideLauncherData(targetPath)) {
      log.warn(`Refused to open a path outside the launcher's data directory: ${targetPath}`);
      return fail("That path is outside the launcher's data directory");
    }
    try {
      await shell.openPath(targetPath);
      return ok(undefined);
    } catch (err) {
      return fail(`Failed to open path: ${reason(err)}`);
    }
  });
  handle('system:open-url', async (_event, url: string) => {
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
  handle(
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
  handle('system:get-logs-path', () => {
    return ok(paths.logsDir);
  });
  /**
   * The tail of the launcher log, or only what has been written since last time.
   *
   * `since` is the `size` from a previous call. With one, this reads just the
   * bytes appended after it — which is what makes the log viewer's two-second
   * poll cost a few hundred bytes instead of re-reading a megabyte, re-splitting
   * it and marshalling five thousand strings across the boundary to arrive at
   * the same list it already had.
   */
  handle('system:read-log', async (_event, lines?: number, since?: number) => {
    const wanted = Math.min(Math.max(lines ?? LOG_TAIL_DEFAULT_LINES, 1), LOG_TAIL_MAX_LINES);
    const file = path.join(paths.logsDir, 'main.log');
    let handle;
    try {
      handle = await fs.open(file, 'r');
      const { size } = await handle.stat();

      // A file that has shrunk was rotated by electron-log (it does so at 5 MB),
      // so the caller's cursor points into a file that no longer exists and the
      // only correct answer is a fresh tail.
      const canResume = typeof since === 'number' && since > 0 && since <= size;
      const follow = canResume && size - since! <= LOG_TAIL_MAX_BYTES;

      if (follow && size === since) return ok({ lines: [], size, reset: false });

      // Only the tail is ever interesting; read a bounded window from the end.
      const start = follow ? since! : Math.max(0, size - LOG_TAIL_MAX_BYTES);
      const buffer = Buffer.alloc(size - start);
      // `read` may return fewer bytes than asked for; decoding the whole buffer
      // regardless appended its NUL padding to the end of the tail.
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);

      const all = buffer.subarray(0, bytesRead).toString('utf-8').split(/\r?\n/);
      // A window that does not start at byte zero almost certainly begins
      // mid-line. Resuming from a cursor does start on a boundary.
      if (start > 0 && !follow) all.shift();

      return ok({
        lines: all.filter((l) => l.length > 0).slice(-wanted),
        size,
        reset: !follow,
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return ok({ lines: [], size: 0, reset: true });
      }
      return fail(`Failed to read log: ${reason(err)}`);
    } finally {
      await handle?.close();
    }
  });

  // ── Settings ─────────────────────────────────────────────
  handle('settings:get', async () => {
    try {
      return ok(await getSettings());
    } catch (err) {
      return fail(`Failed to load settings: ${reason(err)}`);
    }
  });
  handle('settings:update', async (_event, updates: Partial<GlobalSettings>) => {
    try {
      const settings = await updateSettings(updates);
      await applyProxySettings(settings);
      return ok(settings);
    } catch (err) {
      return fail(`Failed to update settings: ${reason(err)}`);
    }
  });
  handle('settings:reset', async () => {
    try {
      const settings = await resetSettings();
      // Same as `settings:update`: the proxy lives in two network stacks, not in
      // the settings file, so clearing the field is not what turns it off.
      // Without this, a reset put every other setting back and left all traffic
      // still going through the proxy the user had just removed — until restart.
      await applyProxySettings(settings);
      return ok(settings);
    } catch (err) {
      return fail(`Failed to reset settings: ${reason(err)}`);
    }
  });
  handle('settings:add-trusted-key', async (_event, key: TrustedKey) => {
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
  handle('settings:remove-trusted-key', async (_event, publicKey: string) => {
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
  handle('news:get', async () => {
    try {
      return ok(await fetchNews());
    } catch (err) {
      return fail(`Failed to fetch news: ${reason(err)}`);
    }
  });
  handle('news:refresh', async () => {
    try {
      return ok(await fetchNews(true));
    } catch (err) {
      return fail(`Failed to refresh news: ${reason(err)}`);
    }
  });
  handle('announcements:get', async () => {
    try {
      return ok(await fetchAnnouncements());
    } catch (err) {
      return fail(`Failed to fetch announcements: ${reason(err)}`);
    }
  });
  handle('announcements:refresh', async () => {
    try {
      return ok(await fetchAnnouncements(true));
    } catch (err) {
      return fail(`Failed to refresh announcements: ${reason(err)}`);
    }
  });
  handle('announcements:dismiss', async (_event, _id: string) => {
    // Dismissal is handled client-side (stored in localStorage / zustand)
    return ok(undefined);
  });

  // ── Auth ─────────────────────────────────────────────────
  handle('auth:login-microsoft', async () => {
    try {
      return ok(await loginMicrosoft());
    } catch (err) {
      log.error('Microsoft login failed:', err);
      return fail(`Login failed: ${reason(err)}`);
    }
  });
  handle('auth:login-offline', async (_event, username: string) => {
    try {
      return ok(await loginOffline(username));
    } catch (err) {
      return fail(`Offline login failed: ${reason(err)}`);
    }
  });
  handle('auth:logout', async (_event, accountId: string) => {
    try {
      await logoutAccount(accountId);
      return ok(undefined);
    } catch (err) {
      return fail(`Logout failed: ${reason(err)}`);
    }
  });
  handle('auth:get-state', async () => {
    try {
      return ok(await getAuthState());
    } catch (err) {
      return fail(`Failed to get auth state: ${reason(err)}`);
    }
  });
  handle('auth:set-active', async (_event, accountId: string) => {
    try {
      await setActiveAccount(accountId);
      return ok(undefined);
    } catch (err) {
      return fail(`Failed to set active account: ${reason(err)}`);
    }
  });
  handle('auth:refresh', async (_event, accountId: string) => {
    try {
      return ok(await refreshAccount(accountId));
    } catch (err) {
      return fail(`Token refresh failed: ${reason(err)}`);
    }
  });

  // ── Profiles ─────────────────────────────────────────────
  handle('profiles:get-all', async () => {
    try {
      return ok(await getAllProfiles());
    } catch (err) {
      return fail(`Failed to get profiles: ${reason(err)}`);
    }
  });
  handle('profiles:get', async (_event, profileId: string) => {
    try {
      return ok(await getProfile(profileId));
    } catch (err) {
      return fail(`Failed to get profile: ${reason(err)}`);
    }
  });
  handle('profiles:create', async (_event, profile) => {
    try {
      return ok(await createProfile(profile));
    } catch (err) {
      return fail(`Failed to create profile: ${reason(err)}`);
    }
  });
  handle('profiles:update', async (_event, profileId: string, updates) => {
    try {
      return ok(await updateProfile(profileId, updates));
    } catch (err) {
      return fail(`Failed to update profile: ${reason(err)}`);
    }
  });
  handle('profiles:delete', async (_event, profileId: string, deleteFiles: boolean) => {
    try {
      await deleteProfile(profileId, deleteFiles);
      return ok(undefined);
    } catch (err) {
      return fail(`Failed to delete profile: ${reason(err)}`);
    }
  });
  handle('profiles:get-file-summary', async (_event, profileId: string) => {
    try {
      return ok(await summarizeProfileFiles(profileId));
    } catch (err) {
      return fail(`Failed to inspect profile files: ${reason(err)}`);
    }
  });
  handle('profiles:list-orphaned', async () => {
    try {
      return ok(await listOrphanedProfiles());
    } catch (err) {
      return fail(`Failed to list kept profile files: ${reason(err)}`);
    }
  });
  handle('profiles:adopt-orphaned', async (_event, profileId: string) => {
    try {
      return ok(await adoptOrphanedProfile(profileId));
    } catch (err) {
      return fail(`Failed to restore that profile: ${reason(err)}`);
    }
  });
  handle('profiles:discard-orphaned', async (_event, profileId: string) => {
    try {
      await discardOrphanedProfile(profileId);
      return ok(undefined);
    } catch (err) {
      return fail(`Failed to delete those files: ${reason(err)}`);
    }
  });
  handle('profiles:duplicate', async (_event, profileId: string, name?: string) => {
    try {
      return ok(await duplicateProfile(profileId, name));
    } catch (err) {
      return fail(`Failed to duplicate profile: ${reason(err)}`);
    }
  });
  handle('profiles:open-folder', async (_event, profileId: string) => {
    try {
      const profile = await getProfile(profileId);
      if (!profile) return fail('Profile not found');
      const dir = resolveGameDir(profile);
      // A profile that has never been launched has no game directory yet, and
      // opening a path that does not exist only produces an error the player
      // cannot act on. Create it: this is where the launcher would put it.
      await fs.mkdir(dir, { recursive: true });
      // `shell.openPath` picks the platform's own file manager — Explorer,
      // Finder, whatever `xdg-open` resolves to — and reports failure by
      // resolving with a message rather than throwing. A headless Linux box
      // with no file manager installed lands there.
      const failure = await shell.openPath(dir);
      if (failure) return fail(failure);
      return ok(undefined);
    } catch (err) {
      return fail(`Failed to open profile folder: ${reason(err)}`);
    }
  });
  handle('profiles:export', async (_event, profileId: string) => {
    try {
      return ok(await exportProfile(profileId));
    } catch (err) {
      return fail(`Failed to export profile: ${reason(err)}`);
    }
  });
  handle('profiles:export-pack', async (_event, profileId: string) => {
    try {
      const win = getMainWindow();
      if (!win) return fail('No window available');
      const profile = await getProfile(profileId);
      if (!profile) return fail('Profile not found');

      // The dialog runs in main, so the renderer never names a destination — it
      // asks for an export and the person at the keyboard says where it goes.
      // `defaultPath` needs a directory as well as a name: given a bare file
      // name the picker opens wherever the process happens to have been
      // started, which for a packaged app is nowhere anybody keeps files.
      const suggested = `${profile.name.replace(/[^\p{L}\p{N} ._-]/gu, '_')}.mrpack`;
      const chosen = await dialog.showSaveDialog(win, {
        defaultPath: path.join(app.getPath('downloads'), suggested),
        filters: [{ name: 'Modrinth modpack', extensions: ['mrpack'] }],
      });
      if (chosen.canceled || !chosen.filePath) return ok(null);

      return ok(await exportProfileAsMrpack(profileId, chosen.filePath));
    } catch (err) {
      return fail(`Could not export that profile as a pack: ${reason(err)}`);
    }
  });
  handle('profiles:import', async (_event, json: string) => {
    try {
      return ok(await importProfile(json));
    } catch (err) {
      return fail(`Failed to import profile: ${reason(err)}`);
    }
  });
  handle('profiles:get-sync-status', async (_event, profileId: string) => {
    try {
      return ok(await getProfileSyncStatus(profileId));
    } catch (err) {
      return fail(`Failed to get sync status: ${reason(err)}`);
    }
  });
  handle('profiles:set-icon', async (_event, profileId: string, sourcePath: string | null) => {
    try {
      const profile = sourcePath
        ? await setProfileIcon(profileId, sourcePath)
        : await clearProfileIcon(profileId);
      return ok(profile);
    } catch (err) {
      return fail(`Failed to set icon: ${reason(err)}`);
    }
  });
  handle('profiles:get-icon', async (_event, profileId: string) => {
    try {
      return ok(await getProfileIconDataUrl(profileId));
    } catch (err) {
      return fail(`Failed to read icon: ${reason(err)}`);
    }
  });

  // ── Packs ────────────────────────────────────────────────
  handle('packs:list-catalogue', async () => {
    try {
      return ok(await listCataloguePacks());
    } catch (err) {
      return fail(`Could not load the pack list: ${reason(err)}`);
    }
  });
  handle('packs:create-from-manifest', async (_event, url: string) => {
    try {
      return ok(await createProfileFromManifest(url));
    } catch (err) {
      return fail(`Could not create a profile from that manifest: ${reason(err)}`);
    }
  });
  handle('packs:create-from-url', async (_event, url: string) => {
    try {
      return ok(await createProfileFromUrl(url));
    } catch (err) {
      return fail(`Could not create a profile from that link: ${reason(err)}`);
    }
  });
  handle('packs:import-mrpack', async (_event, filePath: string) => {
    try {
      return ok(await importMrpack(filePath));
    } catch (err) {
      return fail(`Could not import that pack: ${reason(err)}`);
    }
  });

  // ── Mods ─────────────────────────────────────────────────
  handle('mods:get-installed', async (_event, profileId: string) => {
    try {
      return ok(await getInstalledMods(profileId));
    } catch (err) {
      return fail(`Failed to get installed mods: ${reason(err)}`);
    }
  });
  handle('mods:sync-manifest', async (_event, profileId: string) => {
    try {
      await syncManifest(profileId);
      return ok(undefined);
    } catch (err) {
      return fail(`Mod sync failed: ${reason(err)}`);
    }
  });
  handle('mods:install-from-search', async (_event, profileId, mod, version) => {
    try {
      return ok(await installModFromSearch(profileId, mod, version));
    } catch (err) {
      return fail(`Failed to install mod: ${reason(err)}`);
    }
  });
  handle('mods:check-install', async (_event, profileId, mod) => {
    try {
      const profile = await getProfile(profileId);
      if (!profile) return fail(`Profile ${profileId} not found`);
      return ok(await planModInstall(profile, mod, await getInstalledMods(profileId)));
    } catch (err) {
      return fail(`Could not check compatibility: ${reason(err)}`);
    }
  });
  handle('mods:install-from-file', async (_event, profileId: string, filePath: string) => {
    try {
      return ok(await installModFromFile(profileId, filePath));
    } catch (err) {
      return fail(`Failed to install mod from file: ${reason(err)}`);
    }
  });
  handle('mods:uninstall', async (_event, profileId: string, modId: string) => {
    try {
      await uninstallMod(profileId, modId);
      return ok(undefined);
    } catch (err) {
      return fail(`Failed to uninstall mod: ${reason(err)}`);
    }
  });
  handle(
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
  handle('mods:check-updates', async (_event, profileId: string) => {
    try {
      return ok(await checkModUpdates(profileId));
    } catch (err) {
      return fail(`Could not check for mod updates: ${reason(err)}`);
    }
  });
  handle('mods:update', async (_event, profileId: string, modIds: string[]) => {
    try {
      return ok(await updateMods(profileId, modIds));
    } catch (err) {
      return fail(`Failed to update mods: ${reason(err)}`);
    }
  });
  handle('mods:search', async (_event, filters) => {
    try {
      return ok(await searchMods(filters));
    } catch (err) {
      return fail(`Mod search failed: ${reason(err)}`);
    }
  });
  handle('mods:get-facets', async (_event, projectType) => {
    try {
      return ok(await getSearchFacets(projectType));
    } catch (err) {
      return fail(`Could not load filters: ${reason(err)}`);
    }
  });

  // ── Shaders & Resource Packs ─────────────────────────────
  handle('content:get-shaders', async (_event, profileId: string) => {
    try {
      return ok(await listContent('shaders', profileId));
    } catch (err) {
      return fail(`Failed to list shaders: ${reason(err)}`);
    }
  });
  handle('content:get-resourcepacks', async (_event, profileId: string) => {
    try {
      return ok(await listContent('resourcepacks', profileId));
    } catch (err) {
      return fail(`Failed to list resource packs: ${reason(err)}`);
    }
  });
  handle(
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
  handle('content:check-install', async (_event, profileId, item) => {
    try {
      const profile = await getProfile(profileId);
      if (!profile) return fail(`Profile ${profileId} not found`);
      return ok(await planContentInstall(profile, item));
    } catch (err) {
      return fail(`Could not check compatibility: ${reason(err)}`);
    }
  });
  handle('content:get-shader-loader-state', async (_event, profileId: string) => {
    try {
      const profile = await getProfile(profileId);
      if (!profile) return fail(`Profile ${profileId} not found`);
      return ok(await getShaderLoaderState(profileId, profile.minecraftVersion, profile.modLoader));
    } catch (err) {
      return fail(`Failed to check the shader loader: ${reason(err)}`);
    }
  });
  handle('content:install-shader-loader', async (_event, profileId: string, projectId: string) => {
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
  });
  handle(
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
  handle('content:remove-shader', async (_event, profileId: string, id: string) => {
    try {
      await removeContent('shaders', profileId, id);
      return ok(undefined);
    } catch (err) {
      return fail(`Failed to remove shader: ${reason(err)}`);
    }
  });
  handle('content:remove-resourcepack', async (_event, profileId: string, id: string) => {
    try {
      await removeContent('resourcepacks', profileId, id);
      return ok(undefined);
    } catch (err) {
      return fail(`Failed to remove resource pack: ${reason(err)}`);
    }
  });
  handle(
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
  handle('java:get-installations', async () => {
    try {
      return ok(await getJavaInstallations());
    } catch (err) {
      return fail(`Failed to get Java installations: ${reason(err)}`);
    }
  });
  handle('java:ensure-version', async (_event, majorVersion: number) => {
    try {
      return ok(await ensureJavaVersion(majorVersion));
    } catch (err) {
      return fail(`Failed to ensure Java version: ${reason(err)}`);
    }
  });
  handle('java:detect-system', async () => {
    try {
      return ok(await detectSystemJava());
    } catch (err) {
      return fail(`Failed to detect system Java: ${reason(err)}`);
    }
  });

  // ── Mod Loaders ──────────────────────────────────────────
  handle('loaders:install', async (_event, loader, loaderVersion, mcVersion) => {
    try {
      await installLoader(loader, loaderVersion, mcVersion);
      return ok(undefined);
    } catch (err) {
      return fail(`Failed to install loader: ${reason(err)}`);
    }
  });
  handle('loaders:get-versions', async (_event, loader, mcVersion) => {
    try {
      return ok(await getLoaderVersions(loader, mcVersion));
    } catch (err) {
      return fail(`Failed to get loader versions: ${reason(err)}`);
    }
  });
  handle('loaders:is-installed', async (_event, loader, loaderVersion, mcVersion) => {
    try {
      return ok(await isLoaderInstalled(loader, loaderVersion, mcVersion));
    } catch (err) {
      return fail(`Failed to check loader: ${reason(err)}`);
    }
  });

  // ── Game Launch ──────────────────────────────────────────
  handle('game:launch', async (_event, options) => {
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
  handle('game:kill', async (_event, profileId: string) => {
    try {
      await killGame(profileId);
      return ok(undefined);
    } catch (err) {
      return fail(`Failed to kill game: ${reason(err)}`);
    }
  });
  handle('game:is-running', async (_event, profileId: string) => {
    try {
      return ok(await isGameRunning(profileId));
    } catch (err) {
      return fail(`Failed to check game status: ${reason(err)}`);
    }
  });
  handle('game:get-log-tail', async (_event, profileId: string, lines?: number) => {
    try {
      return ok(getLogTail(profileId, lines));
    } catch (err) {
      return fail(`Failed to read game log: ${reason(err)}`);
    }
  });
  handle('game:cancel', async (_event, profileId: string) => {
    try {
      return ok(cancelJob(profileId));
    } catch (err) {
      return fail(`Failed to cancel: ${reason(err)}`);
    }
  });
  handle('game:get-versions', async (_event, includeSnapshots?: boolean) => {
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
  handle('updater:check', async () => {
    try {
      return ok(await checkForUpdates());
    } catch (err) {
      return fail(`Update check failed: ${reason(err)}`);
    }
  });
  handle('updater:download', async () => {
    try {
      await downloadUpdate();
      return ok(undefined);
    } catch (err) {
      return fail(`Update download failed: ${reason(err)}`);
    }
  });
  handle('updater:install', async () => {
    quitAndInstall();
    return ok(undefined);
  });

  // ── Manifest Verification ────────────────────────────────
  handle('manifest:verify', async (_event, profileId: string) => {
    try {
      return ok(await getLastManifestVerification(profileId));
    } catch (err) {
      return fail(`Manifest verification failed: ${reason(err)}`);
    }
  });

  log.info(`Registered IPC handlers for all channels.`);
}
