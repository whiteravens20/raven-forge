// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The embedded browser's own debugger, which a packaged launcher refuses.
 *
 * `--remote-debugging-port` is Chromium's switch and not Electron's, and there
 * is no fuse for it: the launcher takes it off its own command line. Two things
 * are held here. That both of its forms go, and from a packaged launcher only.
 * And that it is the first thing the main script does — taken off once the app
 * was ready, the switch had been obeyed already and the debugger answered,
 * which is how it went on Electron 44 when that was tried.
 *
 * Whether the browser really stays shut is asked of the installed program, in
 * the packaging job.
 */

const { did, state } = vi.hoisted(() => ({
  /** What the main script did, in the order it did it. */
  did: [] as string[],
  state: { packaged: true },
}));

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return state.packaged;
    },
    commandLine: { removeSwitch: (name: string) => did.push(`take off ${name}`) },
    requestSingleInstanceLock: () => false,
    quit: () => {},
  },
  BrowserWindow: class {},
  Menu: {},
  session: {},
}));

vi.mock('../src/main/home', () => ({
  establishAppHome: () => {
    did.push('settle the home');
    return {};
  },
}));

// The rest of what the main script brings in. It reaches for none of it before
// it has asked for the lock, which here it does not get.
vi.mock('../src/main/logger', () => ({ initLogger: () => {}, log: {} }));
vi.mock('../src/main/window', () => ({ createMainWindow: () => {}, getMainWindow: () => null }));
vi.mock('../src/main/ipc-handlers', () => ({
  holdHandlersUntil: () => {},
  registerAllIpcHandlers: () => {},
}));
vi.mock('../src/main/init', () => ({ ensureDataDirectories: () => Promise.resolve() }));
vi.mock('../src/core/config/settings-manager', () => ({ loadSettings: () => Promise.resolve({}) }));
vi.mock('../src/core/net/proxy', () => ({
  applyProxySettings: () => Promise.resolve(),
  proxyCredentialsFor: () => null,
}));
vi.mock('../src/core/updater/launcher-updater', () => ({
  initUpdater: () => {},
  checkForUpdates: () => Promise.resolve(),
}));
vi.mock('../src/core/mods/mod-sync', () => ({
  checkAllProfilesForPackUpdates: () => Promise.resolve(),
}));

const { refuseRemoteDebugging } = await import('../src/main/security');

beforeEach(() => {
  did.length = 0;
  state.packaged = true;
});

describe("the browser's own debugger", () => {
  it('is taken off a packaged launcher, the port and the pipes alike', () => {
    refuseRemoteDebugging();

    expect(did).toEqual(['take off remote-debugging-port', 'take off remote-debugging-pipe']);
  });

  it('is left alone on a launcher run from the source tree', () => {
    state.packaged = false;

    refuseRemoteDebugging();

    expect(did).toEqual([]);
  });

  it('is refused before the main script does anything else', async () => {
    await import('../src/main/index');

    expect(did.slice(0, 3)).toEqual([
      'take off remote-debugging-port',
      'take off remote-debugging-pipe',
      'settle the home',
    ]);
  });
});
