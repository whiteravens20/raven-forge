import { BrowserWindow, shell } from 'electron';
import path from 'node:path';
import {
  DEFAULT_WINDOW_WIDTH,
  DEFAULT_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
} from '../shared/constants';

let mainWindow: BrowserWindow | null = null;

/**
 * Create the main frameless BrowserWindow with secure defaults.
 */
export function createMainWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    frame: false,
    titleBarStyle: 'hidden',
    // `--rf-bg` of the default theme, so the frame the compositor paints before
    // the first document arrives is already the colour the app settles on.
    backgroundColor: '#0f0f13',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload imports nothing but `electron`, and keytar is only ever
      // touched in the main process, so the renderer needs no Node at all.
      // Verified with a window on screen in the Phase 11 smoke test.
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // Deliberately not `show: false` plus `ready-to-show`. That is the usual way
  // to avoid a white flash, and `backgroundColor` above already handles the
  // flash — what waiting for the first paint also did was leave the desktop
  // with no window and no taskbar button for as long as the renderer took to
  // boot. On a machine that has just installed the app, with a scanner reading
  // app.asar for the first time, that is long enough for someone to decide the
  // launcher did not start and run it a second time. index.html paints its own
  // holding screen, so the window is never blank for a user to interpret.

  // Open external links in system browser, not in Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // `setWindowOpenHandler` only covers `window.open`. A top-level navigation —
  // an `<a href>` without a target, a `location =` — replaces the launcher's own
  // page, preload and all, with whatever it points at. This window loads exactly
  // one document for its lifetime, so anything that tries to change it is either
  // a bug or an attack, and either way belongs in the system browser.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL();
    if (current && url === current) return;
    event.preventDefault();
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
    }
  });

  // Emit maximize state changes to renderer
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized-changed', true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized-changed', false);
  });

  // Load renderer
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
