// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { app, ipcMain, dialog, shell, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { log, LOG_FILE } from './logger';
import { getMainWindow } from './window';
import { assertTrustedSender } from './security';
import { relaunchLauncher } from './relaunch';
import { getSettings, updateSettings, resetSettings } from '../core/config/settings-manager';
import { applyProxySettings, assertProxyUsable } from '../core/net/proxy';
import { paths } from '../core/config/paths';
import {
  dataRootSource,
  dataRootUnavailable,
  defaultDataRoot,
  writeDataRootPointer,
} from '../core/config/data-root';
import { applyDataRoot, pathConcerns, planDataRootChange } from '../core/config/data-root-move';
import { measureStorage } from '../core/config/storage-map';
import { fetchNews, fetchAnnouncements } from '../core/news/news-fetcher';
import {
  getAllProfiles,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  duplicateProfile,
  exportProfile,
  importProfileFile,
  summarizeProfileFiles,
  listOrphanedProfiles,
  adoptOrphanedProfile,
  getUnreadableProfileEntries,
  discardOrphanedProfile,
} from '../core/profiles/profile-manager';
import {
  setProfileIcon,
  clearProfileIcon,
  getProfileIconDataUrl,
} from '../core/profiles/profile-icon';
import {
  listWorlds,
  listBackups,
  backupWorlds,
  restoreBackup,
  deleteBackup,
} from '../core/profiles/world-backup';
import {
  getProfileSyncStatus,
  getLastManifestVerification,
  getInstalledMods,
  syncManifest,
  installModFromSearch,
  uninstallMod,
  toggleModEnabled,
} from '../core/mods/mod-sync';
import { checkModUpdates, updateMods } from '../core/mods/mod-updates';
import { searchMods, getSearchFacets } from '../core/mods/modrinth-api';
import { getProjectDetails } from '../core/mods/project-details';
import { planModInstall, planContentInstall } from '../core/mods/compatibility';
import { listCataloguePacks } from '../core/packs/catalogue';
import {
  importMrpack,
  installModrinthPack,
  createProfileFromManifest,
  createProfileFromUrl,
} from '../core/packs/pack-installer';
import { exportProfileAsMrpack } from '../core/packs/mrpack-export';
import { getShaderLoaderState, installShaderLoader } from '../core/mods/shader-loader';
import { addModFromFile } from '../core/mods/local-mod';
import {
  addContentFromFile,
  listContent,
  installContent,
  removeContent,
  reorderResourcePacks,
} from '../core/mods/content-manager';
import {
  cancelUpdateDownload,
  checkForUpdates,
  downloadUpdate,
  getPendingUpdate,
  quitAndInstall,
  updateSupport,
} from '../core/updater/launcher-updater';
import { detectSystemJava, probeJava } from '../core/java/java-manager';
import { requiredJavaFor } from '../core/minecraft/java-requirement';
import { getLoaderVersions, loaderBuildStarts } from '../core/modloader/loader-manager';
import {
  launchGame,
  killGame,
  isGameBusy,
  isGameRunning,
  getLogLines,
} from '../core/minecraft/game-launcher';
import { getCachedVersionMeta, getVersionManifest } from '../core/minecraft/version-manifest';
import { cancelJob, isCancellation } from '../core/util/cancellation';
import { errorText } from '../core/util/error-text';
import { machineMemoryMb } from '../core/util/machine-memory';
import {
  loginMicrosoft,
  loginOffline,
  logoutAccount,
  getAuthState,
  setActiveAccount,
} from '../core/auth/microsoft-auth';
import type {
  IpcResult,
  IpcErrorCode,
  ErrorMessage,
  ContentKind,
  GlobalSettings,
  TrustedKey,
  MrpackExportOptions,
  WorldBackupReason,
  SystemInfo,
  ShaderLoaderResult,
} from '../shared/ipc-types';
import { AuthServersUnreachableError } from '../core/auth/auth-errors';
import { isConnectionFailure } from '../core/net/connection-failure';
import { refusalOf } from '../core/util/refusal';
import { trustedKeyRing } from '../shared/branding';
import { isEd25519PublicKey } from '../shared/trusted-key';

/** Log tail limits — enough to diagnose a crash, small enough to ship over IPC. */
const LOG_TAIL_DEFAULT_LINES = 500;
const LOG_TAIL_MAX_LINES = 5000;
const LOG_TAIL_MAX_BYTES = 1024 * 1024;

function ok<T>(data: T): IpcResult<T> {
  return { success: true, data };
}

function fail<T>(error: string, code?: IpcErrorCode, errorMessage?: ErrorMessage): IpcResult<T> {
  return {
    success: false,
    error,
    ...(code ? { code } : {}),
    ...(errorMessage ? { errorMessage } : {}),
  };
}

/**
 * The message of a thrown value, without the `Error: ` that template-stringing
 * an Error prepends. These strings are shown to the user verbatim, and
 * "Login failed: Error: Microsoft login is not configured" reads like a bug.
 */
/**
 * What a handler says went wrong: the error, and what was underneath it. A
 * failed request is "fetch failed" whatever the reason, and the reason is the
 * part somebody can act on.
 */
const reason = errorText;

/**
 * A handler's failure, from what it was doing and what stopped it.
 *
 * The English is what gets logged and quoted, with the reason in it. When the
 * reason is that nothing could be reached, the player is told that in their own
 * language: `getaddrinfo EAI_AGAIN api.modrinth.com` is the same news as a
 * cable pulled out, in words only the log needs.
 */
function failed<T>(doing: string, err: unknown, refusal?: ErrorMessage): IpcResult<T> {
  return fail(`${doing}: ${reason(err)}`, undefined, refusal ?? noConnection(err));
}

function noConnection(err: unknown): ErrorMessage | undefined {
  return isConnectionFailure(err) ? { key: 'error.noConnection' } : undefined;
}

/** Settled once the launcher has finished starting — see {@link holdHandlersUntil}. */
let started: Promise<unknown> = Promise.resolve();

/**
 * Have every handler wait for the launcher to finish starting before it runs.
 *
 * The window is opened first and the page asks for its news the moment it is
 * up, while the settings are still being read and the proxy has not been set.
 * On a quick disk the proxy won that race every time; on a slow one the first
 * requests went out directly, past the proxy somebody had configured to keep
 * exactly that from happening. Waiting makes it a rule rather than a habit.
 *
 * The window's own buttons do not wait: a launcher slow to start must still be
 * one that can be closed.
 */
export function holdHandlersUntil(ready: Promise<unknown>): void {
  started = ready;
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
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedSender(event, channel);
    if (!channel.startsWith('window:')) await started;
    return listener(event, ...(args as never[]));
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
      totalMemoryMb: machineMemoryMb(),
      dataDirectory: paths.root,
      crashReportsDirectory: paths.crashReportsDir,
      updateUnsupported: updateSupport(),
    };
    return ok(info);
  });
  handle('system:open-path', async (_event, targetPath: string) => {
    // `shell.openPath` runs whatever the OS associates with the target — an
    // `.exe` or `.bat` on Windows, a `.desktop` entry on Linux — so an
    // unrestricted one is a way to execute an arbitrary file by asking the
    // renderer nicely. Every real caller passes a folder, or a crash report,
    // that the main process itself produced, so confining it to the launcher's
    // own data costs nothing.
    if (!paths.isInsideLauncherData(targetPath)) {
      log.warn(`Refused to open a path outside the launcher's data directory: ${targetPath}`);
      return fail("That path is outside the launcher's data directory");
    }
    // Asked first, because the system is not always able to say: handed a path
    // that does not exist, `shell.openPath` on Linux neither opens anything nor
    // answers, and the button that asked would wait for ever.
    try {
      await fs.stat(targetPath);
    } catch {
      return fail('That folder is not there');
    }
    // `shell.openPath` does not throw: it resolves with a message when the
    // system could not open the thing, and with an empty string when it could.
    // Discarding that made every "open folder" button here report success on a
    // machine with no file manager to open one with.
    const failure = await shell.openPath(targetPath);
    return failure ? fail(failure) : ok(undefined);
  });
  handle('system:get-storage', async () => {
    try {
      return ok(await measureStorage());
    } catch (err) {
      return failed(`Failed to measure the launcher's files`, err);
    }
  });
  handle('system:relaunch', () => {
    relaunchLauncher();
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
      return failed(`Failed to open URL`, err);
    }
  });
  handle(
    'system:select-file',
    async (_event, filters?: { name: string; extensions: string[] }[]) => {
      const win = getMainWindow();
      if (!win) return fail('No window available');
      const result = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        // Named, like every other "pick a file" here, and not left to whatever
        // the Electron in use starts a dialog in: up to 42 that was the folder
        // the system remembered, and from 43 it is this one.
        defaultPath: app.getPath('downloads'),
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
    const file = path.join(paths.logsDir, LOG_FILE);
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
      return failed(`Failed to read log`, err);
    } finally {
      await handle?.close();
    }
  });

  // ── Settings ─────────────────────────────────────────────
  handle('settings:get', async () => {
    try {
      return ok(await getSettings());
    } catch (err) {
      return failed(`Failed to load settings`, err);
    }
  });
  handle('settings:update', async (_event, updates: Partial<GlobalSettings>) => {
    try {
      // Before it is written down, not after: an address that cannot be used
      // must not be what the next start reads.
      if ('proxyUrl' in updates) await assertProxyUsable(updates.proxyUrl);
      const settings = await updateSettings(updates);
      await applyProxySettings(settings);
      return ok(settings);
    } catch (err) {
      return failed(`Failed to update settings`, err);
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
      return failed(`Failed to reset settings`, err);
    }
  });
  handle('settings:add-trusted-key', async (_event, key: TrustedKey) => {
    try {
      // The schema does not ask this: it reads back keys stored before anything
      // checked them, and has to take those as they are.
      if (!isEd25519PublicKey(key.publicKey)) {
        return fail('That is not an Ed25519 public key — it has to be 32 bytes in base64');
      }
      const settings = await getSettings();
      // Against the whole ring, built-in key included. Stored a second time,
      // that one would switch enforcement on from an entry the list hides and
      // offers no button to remove.
      const exists = trustedKeyRing(settings.trustedPublicKeys).some(
        (k) => k.publicKey === key.publicKey,
      );
      if (exists) return fail('That key is already trusted');
      return ok(
        await updateSettings({
          trustedPublicKeys: [...settings.trustedPublicKeys, key],
        }),
      );
    } catch (err) {
      return failed(`Failed to add trusted key`, err);
    }
  });
  handle('settings:remove-trusted-key', async (_event, publicKey: string) => {
    try {
      const settings = await getSettings();
      return ok(
        await updateSettings({
          trustedPublicKeys: settings.trustedPublicKeys.filter((k) => k.publicKey !== publicKey),
        }),
      );
    } catch (err) {
      return failed(`Failed to remove trusted key`, err);
    }
  });

  // ── Data directory ──────────────────────────────────────
  handle('settings:get-data-root', () => {
    try {
      return ok({
        path: paths.root,
        defaultPath: defaultDataRoot(),
        source: dataRootSource(),
        unavailable: dataRootUnavailable(),
        ...pathConcerns(paths.root),
      });
    } catch (err) {
      return failed(`Failed to read the data directory`, err);
    }
  });
  handle('settings:choose-data-root', async () => {
    const win = getMainWindow();
    if (!win) return fail('No window available');
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: paths.root,
    });
    if (result.canceled || result.filePaths.length === 0) return ok(null);
    try {
      return ok(await planDataRootChange(result.filePaths[0]));
    } catch (err) {
      return failed(`Failed to inspect ${result.filePaths[0]}`, err);
    }
  });
  handle('settings:plan-data-root', async (_event, target: string) => {
    try {
      return ok(await planDataRootChange(target));
    } catch (err) {
      return failed(`Failed to inspect ${target}`, err);
    }
  });
  /**
   * The move, and then a restart — which the renderer asks for separately, with
   * `system:relaunch`, once it has shown how the move ended.
   *
   * The restart is not a convenience. Every module that has already read a path
   * — the settings cache, the java manager, an in-flight download — is holding
   * the old root, and there is no version of re-pointing them all that is worth
   * trusting with somebody's saves. Coming back up is the one way that is. It
   * used to follow the move by itself after 600 ms, which left no moment in
   * which to say that some of the old copies could not be removed.
   */
  handle('settings:apply-data-root', async (_event, target: string) => {
    try {
      return ok(
        await applyDataRoot(target, (event) => {
          getMainWindow()?.webContents.send('progress:data-root', event);
        }),
      );
    } catch (err) {
      return failed(`Failed to move the data directory`, err);
    }
  });
  handle('settings:forget-data-root', async () => {
    try {
      // Only for a folder that cannot be reached. With one that can, this would
      // be a way to walk away from the data without the dialog that says so.
      if (!dataRootUnavailable()) return fail('The data directory is reachable');
      await writeDataRootPointer(null);
      return ok(undefined);
    } catch (err) {
      return failed(`Failed to forget the data directory`, err);
    }
  });

  // ── News & Announcements ────────────────────────────────
  handle('news:get', async () => {
    try {
      return ok(await fetchNews());
    } catch (err) {
      return failed(`Failed to fetch news`, err);
    }
  });
  handle('news:refresh', async () => {
    try {
      return ok(await fetchNews(true));
    } catch (err) {
      return failed(`Failed to refresh news`, err);
    }
  });
  handle('announcements:get', async () => {
    try {
      return ok(await fetchAnnouncements());
    } catch (err) {
      return failed(`Failed to fetch announcements`, err);
    }
  });
  handle('announcements:refresh', async () => {
    try {
      return ok(await fetchAnnouncements(true));
    } catch (err) {
      return failed(`Failed to refresh announcements`, err);
    }
  });

  // ── Auth ─────────────────────────────────────────────────
  handle('auth:login-microsoft', async () => {
    try {
      return ok(await loginMicrosoft());
    } catch (err) {
      // Closing the sign-in window is an answer, not an error.
      if (isCancellation(err)) return fail('Sign-in was called off', 'CANCELLED');
      log.error('Microsoft login failed:', err);
      return failed(`Login failed`, err);
    }
  });
  handle('auth:login-offline', async (_event, username: string) => {
    try {
      return ok(await loginOffline(username));
    } catch (err) {
      return failed(`Offline login failed`, err);
    }
  });
  handle('auth:logout', async (_event, accountId: string) => {
    try {
      await logoutAccount(accountId);
      return ok(undefined);
    } catch (err) {
      return failed(`Logout failed`, err);
    }
  });
  handle('auth:get-state', async () => {
    try {
      return ok(await getAuthState());
    } catch (err) {
      return failed(`Failed to get auth state`, err);
    }
  });
  handle('auth:set-active', async (_event, accountId: string) => {
    try {
      await setActiveAccount(accountId);
      return ok(undefined);
    } catch (err) {
      return failed(`Failed to set active account`, err);
    }
  });

  // ── Profiles ─────────────────────────────────────────────
  handle('profiles:get-all', async () => {
    try {
      return ok(await getAllProfiles());
    } catch (err) {
      return failed(`Failed to get profiles`, err);
    }
  });
  handle('profiles:create', async (_event, profile) => {
    try {
      return ok(await createProfile(profile));
    } catch (err) {
      return failed(`Failed to create profile`, err);
    }
  });
  handle('profiles:update', async (_event, profileId: string, updates) => {
    try {
      return ok(await updateProfile(profileId, updates));
    } catch (err) {
      return failed(`Failed to update profile`, err);
    }
  });
  handle('profiles:delete', async (_event, profileId: string, deleteFiles: boolean) => {
    try {
      // The game has the profile's files open, and a launch being prepared is
      // still writing them: deleting underneath either removes what it can and
      // leaves the rest, and the game carries on in a folder that is half gone.
      if (isGameBusy(profileId)) {
        return fail(
          'Close the game first — a profile cannot be deleted while its game is running.',
        );
      }
      await deleteProfile(profileId, deleteFiles);
      return ok(undefined);
    } catch (err) {
      return failed(`Failed to delete profile`, err);
    }
  });
  handle('profiles:get-file-summary', async (_event, profileId: string) => {
    try {
      return ok(await summarizeProfileFiles(profileId));
    } catch (err) {
      return failed(`Failed to inspect profile files`, err);
    }
  });
  handle('profiles:list-orphaned', async () => {
    try {
      return ok(await listOrphanedProfiles());
    } catch (err) {
      return failed(`Failed to list kept profile files`, err);
    }
  });
  handle('profiles:adopt-orphaned', async (_event, profileId: string) => {
    try {
      return ok(await adoptOrphanedProfile(profileId));
    } catch (err) {
      return failed(`Failed to restore that profile`, err);
    }
  });
  handle('profiles:discard-orphaned', async (_event, profileId: string) => {
    try {
      await discardOrphanedProfile(profileId);
      return ok(undefined);
    } catch (err) {
      return failed(`Failed to delete those files`, err);
    }
  });
  handle('profiles:unreadable-entries', async () => {
    try {
      return ok(await getUnreadableProfileEntries());
    } catch (err) {
      return failed(`Failed to read the profile list`, err);
    }
  });
  handle('profiles:duplicate', async (_event, profileId: string, name?: string) => {
    try {
      // The copy takes the worlds, and a world the game has open copies as a
      // half-written region file.
      if (isGameRunning(profileId)) {
        return fail('Close the game first — its worlds cannot be copied while it is open.');
      }
      return ok(await duplicateProfile(profileId, name));
    } catch (err) {
      return failed(`Failed to duplicate profile`, err);
    }
  });
  handle('profiles:open-folder', async (_event, profileId: string) => {
    try {
      const profile = await getProfile(profileId);
      if (!profile) return fail('Profile not found');
      const dir = paths.profileGameDir(profile.id);
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
      return failed(`Failed to open profile folder`, err);
    }
  });
  handle('profiles:export', async (_event, profileId: string) => {
    try {
      return ok(await exportProfile(profileId));
    } catch (err) {
      return failed(`Failed to export profile`, err);
    }
  });
  handle(
    'profiles:export-pack',
    async (_event, profileId: string, options?: MrpackExportOptions) => {
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

        // Only the one answer it is asked for, and only as a yes or a no.
        return ok(
          await exportProfileAsMrpack(profileId, chosen.filePath, {
            settings: options?.settings !== false,
          }),
        );
      } catch (err) {
        return failed(`Could not export that profile as a pack`, err);
      }
    },
  );
  handle('profiles:import', async () => {
    try {
      const win = getMainWindow();
      if (!win) return fail('No window available');
      // Asked here for the same reason the pack export asks here: the renderer
      // never names a path, so there is no path for it to get wrong. It used to
      // pick the file and then read it with `fetch('file://…')`, which only
      // works for as long as the page itself happens to be a `file://` one.
      const chosen = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        defaultPath: app.getPath('downloads'),
        filters: [{ name: 'Raven Forge profile', extensions: ['json'] }],
      });
      if (chosen.canceled || chosen.filePaths.length === 0) return ok(null);
      return ok(await importProfileFile(chosen.filePaths[0]));
    } catch (err) {
      return failed(`Failed to import profile`, err);
    }
  });
  handle('profiles:get-sync-status', async (_event, profileId: string) => {
    try {
      return ok(await getProfileSyncStatus(profileId));
    } catch (err) {
      return failed(`Failed to get sync status`, err);
    }
  });
  handle('profiles:set-icon', async (_event, profileId: string, sourcePath: string | null) => {
    try {
      const profile = sourcePath
        ? await setProfileIcon(profileId, sourcePath)
        : await clearProfileIcon(profileId);
      return ok(profile);
    } catch (err) {
      return failed(`Failed to set icon`, err);
    }
  });
  handle('profiles:get-icon', async (_event, profileId: string) => {
    try {
      return ok(await getProfileIconDataUrl(profileId));
    } catch (err) {
      return failed(`Failed to read icon`, err);
    }
  });

  handle('profiles:list-worlds', async (_event, profileId: string) => {
    try {
      return ok(await listWorlds(profileId));
    } catch (err) {
      return failed(`Failed to list worlds`, err);
    }
  });
  handle('profiles:list-backups', async (_event, profileId: string) => {
    try {
      return ok(await listBackups(profileId));
    } catch (err) {
      return failed(`Failed to list backups`, err);
    }
  });
  handle('profiles:backup-worlds', async (_event, profileId: string, why?: WorldBackupReason) => {
    try {
      // Copying a world the game has open produces a copy of a half-written
      // region file, which restores as corruption. There is no way to take a
      // consistent one from out here, so this refuses instead of pretending.
      if (isGameRunning(profileId)) {
        return fail('Close the game first — a world cannot be copied while it is open.');
      }
      // A reason from the renderer only decides pruning, and `before-restore`
      // is not its to claim — anything unexpected is treated as a
      // deliberate copy, which is the choice that keeps files.
      return ok(await backupWorlds(profileId, why === 'version-change' ? why : 'manual'));
    } catch (err) {
      return failed(`Could not back up the worlds`, err);
    }
  });
  handle('profiles:restore-backup', async (_event, profileId: string, backupId: string) => {
    try {
      if (isGameRunning(profileId)) {
        return fail('Close the game first — its worlds cannot be replaced while it is running.');
      }
      return ok(await restoreBackup(profileId, backupId));
    } catch (err) {
      return failed(`Could not restore that backup`, err);
    }
  });
  handle('profiles:delete-backup', async (_event, profileId: string, backupId: string) => {
    try {
      await deleteBackup(profileId, backupId);
      return ok(undefined);
    } catch (err) {
      return failed(`Could not delete that backup`, err);
    }
  });

  // ── Packs ────────────────────────────────────────────────
  handle('packs:list-catalogue', async () => {
    try {
      return ok(await listCataloguePacks());
    } catch (err) {
      return failed(`Could not load the pack list`, err);
    }
  });
  handle('packs:create-from-manifest', async (_event, url: string) => {
    try {
      return ok(await createProfileFromManifest(url));
    } catch (err) {
      return failed(`Could not create a profile from that manifest`, err);
    }
  });
  handle('packs:create-from-url', async (_event, url: string) => {
    try {
      return ok(await createProfileFromUrl(url));
    } catch (err) {
      return failed(`Could not create a profile from that link`, err);
    }
  });
  handle('packs:import-mrpack', async (_event, filePath: string) => {
    try {
      return ok(await importMrpack(filePath));
    } catch (err) {
      return failed(`Could not import that pack`, err);
    }
  });
  handle('packs:install-modrinth', async (_event, pack, wanted) => {
    try {
      return ok(await installModrinthPack(pack, wanted));
    } catch (err) {
      return failed(`Could not install that pack`, err);
    }
  });

  // ── Mods ─────────────────────────────────────────────────
  /**
   * Said by everything below that changes a profile's mods, shaders or resource
   * packs. The pages switch those controls off while the game is up, but a
   * request already on its way is not stopped by a button going grey — and the
   * game has those files open, or is about to read them.
   */
  const GAME_IS_UP =
    'Close the game first — its files cannot be changed while it is running or being started.';

  handle('mods:get-installed', async (_event, profileId: string) => {
    try {
      return ok(await getInstalledMods(profileId));
    } catch (err) {
      return failed(`Failed to get installed mods`, err);
    }
  });
  handle('mods:sync-manifest', async (_event, profileId: string) => {
    try {
      if (isGameBusy(profileId)) return fail(GAME_IS_UP);
      await syncManifest(profileId);
      return ok(undefined);
    } catch (err) {
      // Stopping a sync is something the player did, not something that went
      // wrong; the profile's state says it was left as it was.
      if (isCancellation(err)) return ok(undefined);
      return failed(`Mod sync failed`, err);
    }
  });
  handle('mods:install-from-search', async (_event, profileId, mod, version) => {
    try {
      if (isGameBusy(profileId)) return fail(GAME_IS_UP);
      return ok(await installModFromSearch(profileId, mod, version));
    } catch (err) {
      return failed(`Failed to install mod`, err);
    }
  });
  handle('mods:add-from-file', async (_event, profileId: string) => {
    try {
      if (isGameBusy(profileId)) return fail(GAME_IS_UP);
      const win = getMainWindow();
      if (!win) return fail('No window available');

      // Asked here for the same reason as for a shader or a resource pack: a
      // channel that took a path would put any file on the disk on the game's
      // class path.
      const chosen = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        defaultPath: app.getPath('downloads'),
        filters: [{ name: 'Minecraft mod', extensions: ['jar'] }],
      });
      if (chosen.canceled || chosen.filePaths.length === 0) return ok(null);
      return ok(await addModFromFile(profileId, chosen.filePaths[0]));
    } catch (err) {
      return fail(`Failed to add that file: ${reason(err)}`, undefined, refusalOf(err));
    }
  });
  handle('mods:check-install', async (_event, profileId, mod) => {
    try {
      const profile = await getProfile(profileId);
      if (!profile) return fail(`Profile ${profileId} not found`);
      return ok(await planModInstall(profile, mod, await getInstalledMods(profileId)));
    } catch (err) {
      return failed(`Could not check compatibility`, err);
    }
  });
  handle('mods:uninstall', async (_event, profileId: string, modId: string) => {
    try {
      if (isGameBusy(profileId)) return fail(GAME_IS_UP);
      await uninstallMod(profileId, modId);
      return ok(undefined);
    } catch (err) {
      return failed(`Failed to uninstall mod`, err);
    }
  });
  handle(
    'mods:toggle-enabled',
    async (_event, profileId: string, modId: string, enabled: boolean) => {
      try {
        if (isGameBusy(profileId)) return fail(GAME_IS_UP);
        await toggleModEnabled(profileId, modId, enabled);
        return ok(undefined);
      } catch (err) {
        return failed(`Failed to toggle mod`, err);
      }
    },
  );
  handle('mods:check-updates', async (_event, profileId: string) => {
    try {
      return ok(await checkModUpdates(profileId));
    } catch (err) {
      return failed(`Could not check for mod updates`, err);
    }
  });
  handle('mods:update', async (_event, profileId: string, modIds: string[]) => {
    try {
      if (isGameBusy(profileId)) return fail(GAME_IS_UP);
      return ok(await updateMods(profileId, modIds));
    } catch (err) {
      return failed(`Failed to update mods`, err);
    }
  });
  handle('mods:search', async (_event, filters) => {
    try {
      return ok(await searchMods(filters));
    } catch (err) {
      return failed(`Mod search failed`, err);
    }
  });
  handle('mods:get-details', async (_event, ids: unknown) => {
    try {
      // Whatever arrives is narrowed to names Modrinth could know before any
      // of it is sent; a profile has a few hundred entries at the very most.
      const keys = Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
      return ok(await getProjectDetails(keys.slice(0, 2000)));
    } catch (err) {
      return failed(`Could not load descriptions`, err);
    }
  });
  handle('mods:get-facets', async (_event, projectType) => {
    try {
      return ok(await getSearchFacets(projectType));
    } catch (err) {
      return failed(`Could not load filters`, err);
    }
  });

  // ── Shaders & Resource Packs ─────────────────────────────
  handle('content:get-shaders', async (_event, profileId: string) => {
    try {
      return ok(await listContent('shaders', profileId));
    } catch (err) {
      return failed(`Failed to list shaders`, err);
    }
  });
  handle('content:get-resourcepacks', async (_event, profileId: string) => {
    try {
      return ok(await listContent('resourcepacks', profileId));
    } catch (err) {
      return failed(`Failed to list resource packs`, err);
    }
  });
  handle(
    'content:install-shader',
    async (_event, profileId: string, projectId: string, version?: string) => {
      try {
        if (isGameBusy(profileId)) return fail(GAME_IS_UP);
        await installContent('shaders', profileId, projectId, version);
        return ok(undefined);
      } catch (err) {
        return failed(`Failed to install shader`, err);
      }
    },
  );
  handle('content:check-install', async (_event, profileId, item) => {
    try {
      const profile = await getProfile(profileId);
      if (!profile) return fail(`Profile ${profileId} not found`);
      return ok(await planContentInstall(profile, item));
    } catch (err) {
      return failed(`Could not check compatibility`, err);
    }
  });
  handle('content:get-shader-loader-state', async (_event, profileId: string) => {
    try {
      const profile = await getProfile(profileId);
      if (!profile) return fail(`Profile ${profileId} not found`);
      return ok(await getShaderLoaderState(profileId, profile.minecraftVersion, profile.modLoader));
    } catch (err) {
      return failed(`Failed to check the shader loader`, err);
    }
  });
  handle('content:install-shader-loader', async (_event, profileId: string, projectId: string) => {
    try {
      if (isGameBusy(profileId)) return fail(GAME_IS_UP);
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
    async (_event, profileId: string, projectId: string, version?: string) => {
      try {
        if (isGameBusy(profileId)) return fail(GAME_IS_UP);
        await installContent('resourcepacks', profileId, projectId, version);
        return ok(undefined);
      } catch (err) {
        return failed(`Failed to install resource pack`, err);
      }
    },
  );
  handle('content:remove-shader', async (_event, profileId: string, id: string) => {
    try {
      if (isGameBusy(profileId)) return fail(GAME_IS_UP);
      await removeContent('shaders', profileId, id);
      return ok(undefined);
    } catch (err) {
      return failed(`Failed to remove shader`, err);
    }
  });
  handle('content:remove-resourcepack', async (_event, profileId: string, id: string) => {
    try {
      if (isGameBusy(profileId)) return fail(GAME_IS_UP);
      await removeContent('resourcepacks', profileId, id);
      return ok(undefined);
    } catch (err) {
      return failed(`Failed to remove resource pack`, err);
    }
  });
  handle(
    'content:reorder-resourcepacks',
    async (_event, profileId: string, orderedIds: string[]) => {
      try {
        if (isGameBusy(profileId)) return fail(GAME_IS_UP);
        await reorderResourcePacks(profileId, orderedIds);
        return ok(undefined);
      } catch (err) {
        return failed(`Failed to reorder resource packs`, err);
      }
    },
  );
  handle('content:add-from-file', async (_event, profileId: string, kind: ContentKind) => {
    try {
      // Checked here, not assumed: it picks the folder the file is copied into.
      if (kind !== 'shaders' && kind !== 'resourcepacks') return fail('Not a kind of pack');
      if (isGameBusy(profileId)) return fail(GAME_IS_UP);
      const win = getMainWindow();
      if (!win) return fail('No window available');

      // Which file is asked here, so the page never names a path: a channel
      // that took one would copy any file on the disk into a profile, for
      // whoever could send it a message.
      const chosen = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        defaultPath: app.getPath('downloads'),
        filters: [{ name: 'Zip archive', extensions: ['zip'] }],
      });
      if (chosen.canceled || chosen.filePaths.length === 0) return ok(null);
      return ok(await addContentFromFile(kind, profileId, chosen.filePaths[0]));
    } catch (err) {
      // A refusal carries the same sentence twice: English here for the log,
      // and a key the page says in the player's language.
      return fail(`Failed to add that file: ${reason(err)}`, undefined, refusalOf(err));
    }
  });

  // ── Java ─────────────────────────────────────────────────
  handle('java:detect-system', async () => {
    try {
      return ok(await detectSystemJava());
    } catch (err) {
      return failed(`Failed to detect system Java`, err);
    }
  });
  handle('java:probe', async (_event, binPath: string, minecraftVersion: string) => {
    try {
      // The requirement as Mojang states it when this version's metadata is
      // already on disk, and by rule when it is not: fetching it for a field
      // somebody is still typing in would be a network round trip per keystroke.
      const meta = await getCachedVersionMeta(minecraftVersion);
      return ok({
        version: await probeJava(binPath),
        requiredVersion: requiredJavaFor(minecraftVersion, meta),
      });
    } catch (err) {
      return failed(`Failed to check ${binPath}`, err);
    }
  });

  // ── Mod Loaders ──────────────────────────────────────────
  handle('loaders:get-versions', async (_event, loader, mcVersion) => {
    try {
      return ok(await getLoaderVersions(loader, mcVersion));
    } catch (err) {
      return failed(`Failed to get loader versions`, err);
    }
  });
  handle('loaders:build-starts', async (_event, loader, loaderVersion, mcVersion) => {
    try {
      return ok(await loaderBuildStarts(loader, loaderVersion, mcVersion));
    } catch (err) {
      return failed(`Failed to check the loader build`, err);
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
      // A refusal carries the same sentence twice: English here for the log,
      // and a key the renderer says in the player's language.
      return failed(`Failed to launch game`, err, refusalOf(err));
    }
  });
  handle('game:kill', async (_event, profileId: string) => {
    try {
      await killGame(profileId);
      return ok(undefined);
    } catch (err) {
      return failed(`Failed to kill game`, err);
    }
  });
  /**
   * Which profiles have a game up.
   *
   * Worked out from the profile list, because the launcher only ever starts a
   * game for a profile and `isGameRunning` is the question it already answers.
   * The renderer's own record comes from `game:started` and `game:exited`, and
   * is gone when its page reloads — which is what the error screen's button
   * does. Without this it came back offering Play for a game that was running
   * and no way to stop it.
   */
  handle('game:get-running', async () => {
    try {
      const profiles = await getAllProfiles();
      return ok(profiles.map((profile) => profile.id).filter(isGameRunning));
    } catch (err) {
      return failed(`Failed to list running games`, err);
    }
  });
  handle('game:get-log-tail', async (_event, profileId: string) => {
    try {
      return ok(getLogLines(profileId));
    } catch (err) {
      return failed(`Failed to read game log`, err);
    }
  });
  handle('game:cancel', async (_event, profileId: string) => {
    try {
      return ok(cancelJob(profileId));
    } catch (err) {
      return failed(`Failed to cancel`, err);
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
      return failed(`Failed to list Minecraft versions`, err);
    }
  });

  // ── Updater ──────────────────────────────────────────────
  handle('updater:check', async () => {
    try {
      return ok(await checkForUpdates());
    } catch (err) {
      return failed(`Update check failed`, err);
    }
  });
  handle('updater:get-pending', async () => ok(getPendingUpdate()));
  handle('updater:download', async () => {
    try {
      return ok(await downloadUpdate());
    } catch (err) {
      // The page says what it was doing, in the player's language, and quotes
      // this after it.
      return fail(reason(err), undefined, noConnection(err));
    }
  });
  handle('updater:cancel-download', async () => {
    cancelUpdateDownload();
    return ok(undefined);
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
      return failed(`Manifest verification failed`, err);
    }
  });

  log.info(`Registered IPC handlers for all channels.`);
}
