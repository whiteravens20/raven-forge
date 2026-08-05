import { app, BrowserWindow } from 'electron';
import { initLogger, log } from './logger';
import { createMainWindow } from './window';
import { registerAllIpcHandlers } from './ipc-handlers';
import { loadSettings } from '../core/config/settings-manager';
import { ensureDataDirectories } from './init';
import { applyProxySettings } from '../core/net/proxy';
import { initUpdater, checkForUpdates } from '../core/updater/launcher-updater';

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

  registerAllIpcHandlers();
  createMainWindow();

  initUpdater();
  void checkForUpdates();

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
