import { app, BrowserWindow } from 'electron';
import { initLogger, log } from './logger';
import { createMainWindow } from './window';
import { installContentSecurityPolicy } from './security';
import { registerAllIpcHandlers } from './ipc-handlers';
import { loadSettings } from '../core/config/settings-manager';
import { ensureDataDirectories } from './init';
import { applyProxySettings } from '../core/net/proxy';
import { initUpdater, checkForUpdates } from '../core/updater/launcher-updater';
import { checkAllProfilesForPackUpdates } from '../core/mods/mod-sync';

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(async () => {
  initLogger();

  try {
    await ensureDataDirectories();
    // Before anything fetches: the updater check below is an outbound request.
    await applyProxySettings(await loadSettings());
  } catch (err) {
    log.error('Failed to initialize:', err);
  }

  // Before the window exists, so the very first document is already covered.
  installContentSecurityPolicy();

  registerAllIpcHandlers();
  createMainWindow();

  initUpdater();
  void checkForUpdates();
  // The launcher's own update check has a counterpart for the packs profiles
  // follow. Both are fire-and-forget: neither should hold up the window.
  void checkAllProfilesForPackUpdates();

  log.info('Raven Forge Launcher ready.');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});
