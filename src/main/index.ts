import { app, BrowserWindow } from 'electron';
import { initLogger, log } from './logger';
import { createMainWindow, getMainWindow } from './window';
import { installContentSecurityPolicy } from './security';
import { registerAllIpcHandlers } from './ipc-handlers';
import { loadSettings } from '../core/config/settings-manager';
import { ensureDataDirectories } from './init';
import { applyProxySettings } from '../core/net/proxy';
import { initUpdater, checkForUpdates } from '../core/updater/launcher-updater';
import { checkAllProfilesForPackUpdates } from '../core/mods/mod-sync';

/**
 * Everything the app does once it knows it is the only copy running.
 *
 * Behind the lock rather than beside it: `app.quit()` on the losing process
 * means it never becomes ready, so in practice `whenReady` never fires there —
 * but that is a race being relied on instead of a rule, and the window is now
 * created in the first tick of the handler, so losing the race would put a
 * second window on screen and take it away again.
 */
function registerAppLifecycle(): void {
  app.on('second-instance', () => {
    // The launcher's own window, not whichever one happens to be first: a
    // sign-in is a second BrowserWindow, and raising that instead would answer a
    // click on the desktop icon by focusing a Microsoft login page.
    const win = getMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      if (!win.isVisible()) win.show();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    initLogger();

    // The window is opened before any of the setup below it. None of that setup
    // is slow — six mkdirs and a settings file — but all of it used to run with
    // nothing on screen, on top of the seconds Electron itself takes to boot on
    // a cold install. What the user saw was a desktop that did not react.
    //
    // CSP first regardless: it has to be installed before the very first
    // document, and handlers have to exist before the renderer can invoke one.
    installContentSecurityPolicy();
    registerAllIpcHandlers();
    createMainWindow();

    try {
      await ensureDataDirectories();
      // Before anything fetches: the updater check below is an outbound request.
      await applyProxySettings(await loadSettings());
    } catch (err) {
      log.error('Failed to initialize:', err);
    }

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
}

// Prevent multiple instances.
if (app.requestSingleInstanceLock()) {
  registerAppLifecycle();
} else {
  app.quit();
}
