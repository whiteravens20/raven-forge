// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { autoUpdater, CancellationToken } from 'electron-updater';
import { app } from 'electron';
import { log } from '../../main/logger';
import { getMainWindow } from '../../main/window';
import { abandonProgress, emitProgress } from '../util/progress';
import type {
  UpdateCheck,
  UpdateDownloadEnd,
  UpdateInfo,
  UpdateUnsupportedReason,
} from '../../shared/ipc-types';
import { errorText } from '../util/error-text';
import { isConnectionFailure } from '../net/connection-failure';
import { getSettings } from '../config/settings-manager';
import { clearPendingUpdate } from './update-cache';

/** The one bar the update download draws. */
const UPDATE_OPERATION = 'launcher-update';

let initialized = false;
let pendingUpdate: UpdateInfo | null = null;
let downloadedUpdate: UpdateInfo | null = null;
/** The download under way: what a cancel has to reach, and what a second request joins. */
let download: { token: CancellationToken; ended: Promise<UpdateDownloadEnd> } | null = null;

export function initUpdater(): void {
  if (initialized) return;
  initialized = true;

  autoUpdater.logger = log;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    pendingUpdate = { version: info.version };
    log.info(`Launcher update available: ${info.version}`);
    getMainWindow()?.webContents.send('updater:update-available', pendingUpdate);
  });

  autoUpdater.on('update-not-available', () => {
    pendingUpdate = null;
    // Nothing newer than this build is published, so a download left over from
    // before it was installed has no use left. Unless this very session fetched
    // it: that one is installed when the launcher quits, whatever a later check
    // has to say.
    if (!downloadedUpdate) {
      void clearPendingUpdate().catch((err: unknown) => {
        log.warn(`Could not clear an old update download: ${errorText(err)}`);
      });
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    emitProgress('progress:launcher-update', {
      operationId: UPDATE_OPERATION,
      progress: progress.percent / 100,
      message: {
        key: 'progress.msg.updateDownloading',
        vars: { percent: progress.percent.toFixed(0) },
      },
      bytesDownloaded: progress.transferred,
      bytesTotal: progress.total,
      installing: true,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    downloadedUpdate = { version: info.version };
    log.info(`Launcher update downloaded: ${info.version}`);
    getMainWindow()?.webContents.send('updater:update-downloaded', downloadedUpdate);
  });

  autoUpdater.on('error', (err) => {
    log.warn(`Updater error: ${errorText(err)}`);
    // A download that died half-way reports nothing further, and its bar
    // would stay at whatever it had reached.
    abandonProgress(UPDATE_OPERATION);
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
    log.warn(`Update check failed: ${errorText(err)}`);
    return {
      status: 'failed',
      currentVersion,
      error: err instanceof Error ? err.message : String(err),
      ...(isConnectionFailure(err) ? { errorMessage: { key: 'error.noConnection' } as const } : {}),
    };
  }
}

/**
 * What the last check found. Its event goes to a page that may not have loaded
 * yet, on a quick network and a slow disk, and an event nobody is listening for
 * is lost: the update then went unannounced until some later start.
 */
export function getPendingUpdate(): UpdateInfo | null {
  return pendingUpdate;
}

/** The question asked without anybody pressing anything, which Settings can switch off. */
export async function checkForUpdatesAtStart(): Promise<void> {
  if (!(await getSettings()).checkUpdatesOnStart) {
    log.info('Not asking about a launcher update at this start: switched off in Settings');
    return;
  }
  await checkForUpdates();
}

export async function downloadUpdate(): Promise<UpdateDownloadEnd> {
  if (download) return download.ended;
  const unsupported = updateSupport();
  if (unsupported) throw new Error(`Cannot self-update this build (${unsupported})`);
  initUpdater();

  const token = new CancellationToken();
  const ended = autoUpdater
    .downloadUpdate(token)
    .then(
      (): UpdateDownloadEnd => 'downloaded',
      (err: unknown): UpdateDownloadEnd => {
        if (!token.cancelled) throw err;
        // electron-updater has removed its partial file by now and reports
        // this as no error, so the handler that takes the bar down never runs.
        log.info('Launcher update download cancelled');
        abandonProgress(UPDATE_OPERATION);
        return 'cancelled';
      },
    )
    .finally(() => {
      download = null;
    });
  download = { token, ended };
  return ended;
}

/**
 * Stops the download under way; with none running, there is nothing to do.
 *
 * electron-updater stops writing and removes its partial file, and leaves the
 * request itself alone. The connection fills its buffers and stalls (9 MB later,
 * measured over loopback), and stays open until the server gives up on it or the
 * launcher closes. Nothing more arrives, and the next attempt opens its own.
 */
export function cancelUpdateDownload(): void {
  download?.token.cancel();
}

export function quitAndInstall(): void {
  if (!downloadedUpdate) {
    app.quit();
    return;
  }
  // Silent, and restarted afterwards. The default runs the NSIS installer with
  // its full interface, which asks somebody who has already agreed to update
  // for a destination they chose once and a licence they accepted once, and
  // then leaves them on a Finish page to close by hand. Nothing on those pages
  // is a decision an update needs: the destination is where the app already is.
  // `isForceRunAfter` is what makes the second argument matter — a silent
  // install would otherwise end with the launcher gone from the screen.
  autoUpdater.quitAndInstall(true, true);
}
