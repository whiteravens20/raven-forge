import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { vi } from 'vitest';

/**
 * The two ends of the IPC contract, counted against each other.
 *
 * `ipc-types.ts` types the arguments and the result of every channel, and gets
 * all of that right at compile time. The one thing it cannot state is that the
 * channel *exists*: `ipcRenderer.invoke('mods:get-installed')` and
 * `ipcMain.handle('mods:get-installed')` are two string literals in two files
 * that the type system never introduces to each other. Misspell one, rename a
 * channel on one side, or add a method to the preload API and forget the
 * handler, and it all compiles — then the button does nothing and the console
 * says "No handler registered", which is the first anyone hears of it.
 *
 * So both ends are loaded for real: the preload's API object is walked and
 * every method called, and the main process's registration is run against a
 * recording `ipcMain`. What is left is two sets of strings that have to match.
 */

const { registered, invoked, exposed } = vi.hoisted(() => ({
  registered: [] as string[],
  invoked: [] as string[],
  exposed: {} as Record<string, unknown>,
}));

const userData = path.join(os.tmpdir(), 'raven-forge-ipc-contract');

vi.mock('electron', () => ({
  app: {
    getPath: () => userData,
    getVersion: () => '0.0.0-test',
    isPackaged: false,
    on: () => {},
    whenReady: () => new Promise(() => {}),
    requestSingleInstanceLock: () => true,
    quit: () => {},
  },
  ipcMain: {
    handle: (channel: string) => registered.push(channel),
    on: () => {},
  },
  ipcRenderer: {
    invoke: (channel: string) => {
      invoked.push(channel);
      return Promise.resolve({ success: true });
    },
    on: () => {},
    removeListener: () => {},
  },
  contextBridge: {
    exposeInMainWorld: (_name: string, api: Record<string, unknown>) => {
      Object.assign(exposed, api);
    },
  },
  dialog: { showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }) },
  shell: { openExternal: () => Promise.resolve(), openPath: () => Promise.resolve('') },
  session: {
    defaultSession: {
      setProxy: () => Promise.resolve(),
      webRequest: { onHeadersReceived: () => {} },
    },
  },
  safeStorage: { isEncryptionAvailable: () => false },
  BrowserWindow: class {},
  nativeTheme: { on: () => {} },
}));

vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  initLogger: () => {},
}));

/** Every channel the preload can reach, by calling everything it exposes. */
async function preloadChannels(): Promise<string[]> {
  await import('../src/preload/index');
  for (const group of Object.values(exposed)) {
    // `on` is the event subscription and takes a channel as an argument rather
    // than naming one; it has no counterpart in `ipcMain.handle`.
    if (typeof group !== 'object' || group === null) continue;
    for (const method of Object.values(group as Record<string, unknown>)) {
      if (typeof method === 'function') (method as () => unknown)();
    }
  }
  return invoked;
}

let fromPreload: string[];
let fromMain: string[];

beforeAll(async () => {
  process.env.RAVENFORGE_DATA_DIR = path.join(userData, 'data');
  fromPreload = await preloadChannels();

  const { registerAllIpcHandlers } = await import('../src/main/ipc-handlers');
  registerAllIpcHandlers();
  fromMain = registered;
});

describe('the invoke channels', () => {
  it('are found on both sides, so the comparison means something', () => {
    expect(fromPreload.length).toBeGreaterThan(50);
    expect(fromMain.length).toBeGreaterThan(50);
  });

  it('every one the renderer can call has a handler in the main process', () => {
    const orphans = fromPreload.filter((channel) => !fromMain.includes(channel));
    expect(orphans).toEqual([]);
  });

  it('every handler the main process registers is reachable from the renderer', () => {
    // The other direction is not a crash, it is dead weight: a handler nothing
    // can call is code that will be maintained forever by mistake.
    const unreachable = fromMain.filter((channel) => !fromPreload.includes(channel));
    expect(unreachable).toEqual([]);
  });

  it('registers each channel exactly once', () => {
    // `ipcMain.handle` replaces a duplicate silently, so the second registration
    // of a name wins and the first is simply gone.
    const counts = new Map<string, number>();
    for (const channel of fromMain) counts.set(channel, (counts.get(channel) ?? 0) + 1);
    expect([...counts].filter(([, times]) => times > 1).map(([channel]) => channel)).toEqual([]);
  });

  it('names every channel as group:action', () => {
    // The convention the whole file map depends on, and the shape the sender
    // guard and the log lines are written around.
    expect(fromMain.filter((channel) => !/^[a-z]+:[a-z-]+$/.test(channel))).toEqual([]);
  });
});
