import { autoUpdater } from 'electron-updater';
import { app } from 'electron';
import { log } from '../../main/logger';
import { getMainWindow } from '../../main/window';
import type { UpdateCheck, UpdateInfo, UpdateUnsupportedReason } from '../../shared/ipc-types';

let initialized = false;
let pendingUpdate: UpdateInfo | null = null;
let downloadedUpdate: UpdateInfo | null = null;

export function initUpdater(): void {
  if (initialized) return;
  initialized = true;

  autoUpdater.logger = log;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    pendingUpdate = {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    };
    log.info(`Launcher update available: ${info.version}`);
    getMainWindow()?.webContents.send('updater:update-available', pendingUpdate);
  });

  autoUpdater.on('update-not-available', () => {
    pendingUpdate = null;
  });

  autoUpdater.on('download-progress', (progress) => {
    getMainWindow()?.webContents.send('progress:launcher-update', {
      operationId: 'launcher-update',
      progress: progress.percent / 100,
      message: {
        key: 'progress.msg.updateDownloading',
        vars: { percent: progress.percent.toFixed(0) },
      },
      bytesDownloaded: progress.transferred,
      bytesTotal: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    downloadedUpdate = {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    };
    log.info(`Launcher update downloaded: ${info.version}`);
    getMainWindow()?.webContents.send('updater:update-downloaded', downloadedUpdate);
  });

  autoUpdater.on('error', (err) => {
    log.warn(`Updater error: ${err.message}`);
  });
}

/**
 * Whether a build can replace itself, and why not when it cannot.
 *
 * electron-updater can only update an artifact it owns, and that differs by
 * platform:
 *
 *   - **Windows** — the NSIS installer is self-updating. Supported.
 *   - **Linux, AppImage** — a single file the runtime can swap. Supported.
 *   - **Linux, .deb/.rpm** — dpkg/rpm own those files. Overwriting them behind
 *     the package manager's back breaks the next `apt upgrade`, so this is a
 *     refusal, not a limitation to work around. `APPIMAGE` is set by the
 *     AppImage runtime itself, so its absence on Linux means some other install.
 *   - **macOS** — Squirrel.Mac requires a signed, notarised bundle; an unsigned
 *     one fails at install time rather than at check time. Nothing here builds
 *     for macOS today, so this is reported honestly rather than half-attempted.
 *
 * Taken as arguments so the matrix can be tested without pretending to be four
 * operating systems.
 */
export function updateSupportFor(
  packaged: boolean,
  platform: NodeJS.Platform,
  isAppImage: boolean,
): UpdateUnsupportedReason | null {
  if (!packaged) return 'development';
  if (platform === 'linux' && !isAppImage) return 'system-package';
  if (platform === 'darwin') return 'unsigned-platform';
  return null;
}

export function updateSupport(): UpdateUnsupportedReason | null {
  return updateSupportFor(app.isPackaged, process.platform, Boolean(process.env.APPIMAGE));
}

export async function checkForUpdates(): Promise<UpdateCheck> {
  const currentVersion = app.getVersion();

  const unsupported = updateSupport();
  if (unsupported) {
    log.info(`Skipping updater check — ${unsupported}`);
    return { status: 'unsupported', currentVersion, reason: unsupported };
  }

  initUpdater();
  try {
    const result = await autoUpdater.checkForUpdates();
    // A failed check and an up-to-date launcher must not look the same. Saying
    // "you are up to date" when we could not reach GitHub is how someone stays
    // on a build with a known security fix missing.
    if (!result?.updateInfo || result.updateInfo.version === currentVersion || !pendingUpdate) {
      return { status: 'up-to-date', currentVersion };
    }
    return { status: 'available', currentVersion, update: pendingUpdate };
  } catch (err) {
    log.warn(`Update check failed: ${err}`);
    return {
      status: 'failed',
      currentVersion,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function downloadUpdate(): Promise<void> {
  const unsupported = updateSupport();
  if (unsupported) throw new Error(`Cannot self-update this build (${unsupported})`);
  initUpdater();
  await autoUpdater.downloadUpdate();
}

export function quitAndInstall(): void {
  if (!downloadedUpdate) {
    app.quit();
    return;
  }
  autoUpdater.quitAndInstall();
}
