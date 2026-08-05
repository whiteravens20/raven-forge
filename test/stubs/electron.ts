/**
 * Minimal `electron` stand-in for tests.
 *
 * Modules under `src/core/` reach Electron only through `paths.ts` and
 * `logger.ts`, both of which want `app.getPath('userData')` at import time.
 * Aliasing the module (see vitest.config.ts) means a pure function does not
 * have to be pulled out of its file just to become testable.
 *
 * It is deliberately incomplete: a test that reaches further than this hits an
 * "is not a function" error, which is the right outcome — anything needing more
 * of Electron than a temp directory is not a unit test.
 */
import os from 'node:os';
import path from 'node:path';

const userData = path.join(os.tmpdir(), 'raven-forge-test-userdata');

export const app = {
  getPath: (name: string) => path.join(userData, name === 'userData' ? '' : name),
  getVersion: () => '0.0.0-test',
  isPackaged: false,
};

export const session = {
  defaultSession: {
    setProxy: () => Promise.resolve(),
  },
};

export const BrowserWindow = class {};
export const ipcMain = { handle: () => {}, on: () => {} };
export const shell = { openExternal: () => Promise.resolve() };
export const safeStorage = { isEncryptionAvailable: () => false };
