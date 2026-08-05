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
    backgroundColor: '#0f1117',
    show: false,
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

  // Show window when renderer is ready (avoids white flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Open external links in system browser, not in Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
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
