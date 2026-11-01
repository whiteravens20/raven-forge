// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * What the launcher asks of electron-updater, and what it makes of the answer.
 *
 * electron-updater itself is stood in for: what is pinned here is that the
 * question at a start obeys the setting.
 */

const updater = vi.hoisted(() => ({
  listeners: new Map<string, (...args: unknown[]) => void>(),
  checkForUpdates: vi.fn(async () => null as unknown),
  downloadUpdate: vi.fn(async (_token: unknown) => [] as string[]),
}));
const settings = vi.hoisted(() => ({ checkUpdatesOnStart: true }));
const sent = vi.hoisted(() => [] as Array<[string, unknown]>);

vi.mock('electron-updater', async () => {
  const { CancellationToken } = await import('builder-util-runtime');
  return {
    CancellationToken,
    autoUpdater: {
      on: (event: string, listener: (...args: unknown[]) => void) =>
        updater.listeners.set(event, listener),
      checkForUpdates: updater.checkForUpdates,
      downloadUpdate: updater.downloadUpdate,
    },
  };
});
vi.mock('electron', () => ({ app: { isPackaged: true, getVersion: () => '0.8.0' } }));
vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));
vi.mock('../src/main/window', () => ({
  getMainWindow: () => ({
    isDestroyed: () => false,
    webContents: { send: (channel: string, payload: unknown) => sent.push([channel, payload]) },
  }),
}));
vi.mock('../src/core/config/settings-manager', () => ({ getSettings: async () => settings }));
vi.mock('../src/core/updater/update-cache', () => ({ clearPendingUpdate: async () => {} }));

/** Each test gets the module afresh: what it holds is the download under way. */
async function load() {
  vi.resetModules();
  const updaterModule = await import('../src/core/updater/launcher-updater');
  updaterModule.initUpdater();
  return updaterModule;
}

beforeEach(() => {
  updater.listeners.clear();
  updater.checkForUpdates.mockClear();
  updater.downloadUpdate.mockClear();
  settings.checkUpdatesOnStart = true;
  sent.length = 0;
  // Stands for a build that can update itself, on Linux and on Windows alike.
  process.env.APPIMAGE = '/a/launcher.AppImage';
});

afterEach(() => {
  delete process.env.APPIMAGE;
});

describe('the question at a start', () => {
  it('is asked when the setting is on', async () => {
    const { checkForUpdatesAtStart } = await load();
    await checkForUpdatesAtStart();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('is not asked when the setting is off', async () => {
    settings.checkUpdatesOnStart = false;
    const { checkForUpdatesAtStart } = await load();
    await checkForUpdatesAtStart();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('stays available by hand when the setting is off', async () => {
    settings.checkUpdatesOnStart = false;
    const { checkForUpdates } = await load();
    await checkForUpdates();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });
});

describe('what the check found', () => {
  it('can be asked for afterwards, by a page that was not there to hear it', async () => {
    const { getPendingUpdate } = await load();
    expect(getPendingUpdate()).toBeNull();

    updater.listeners.get('update-available')?.({ version: '0.9.0' });
    expect(getPendingUpdate()).toEqual({ version: '0.9.0' });

    updater.listeners.get('update-not-available')?.();
    expect(getPendingUpdate()).toBeNull();
  });
});
