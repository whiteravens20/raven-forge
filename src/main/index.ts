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
 * Catch what nothing else was going to catch.
 *
 * Without these, an exception thrown from an event handler — rather than from
 * inside an `await` chain somebody wrapped — ends the main process on the spot:
 * no log line, no crash report, the window simply gone. The launcher writes a
 * careful crash report when *Minecraft* dies and had nothing at all to say about
 * its own death.
 *
 * Logged and survived rather than logged and quit. Node's default is to exit,
 * and that default suits a server, where a process in an unknown state should be
 * replaced by a fresh one. Here there is nothing to replace it with and no
 * supervisor to do it: the realistic faults are a write that failed on a full
 * disk or a socket that answered with nonsense, and the honest response to those
 * is to say so in the log and let the player keep the window they had. The log
 * is the record; a fault that has genuinely broken the process will show up
 * again immediately and be recorded again.
 */
function registerCrashHandlers(): void {
  process.on('uncaughtException', (err) => {
    log.error('Uncaught exception in the main process:', err);
  });

  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled promise rejection in the main process:', reason);
  });

  app.on('render-process-gone', (_event, _contents, details) => {
    log.error(`Renderer process gone: ${details.reason} (exit code ${details.exitCode})`);
  });

  app.on('child-process-gone', (_event, details) => {
    log.error(
      `Child process gone: ${details.type} ${details.name ?? ''} — ${details.reason} ` +
        `(exit code ${details.exitCode})`,
    );
  });
}

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

    // After the logger and before anything that can throw: these exist to write
    // to the log, so registering them earlier would only lose what they caught.
    registerCrashHandlers();

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
