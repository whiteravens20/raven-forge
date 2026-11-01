// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * What the launcher asks of electron-updater, and what it makes of the answer.
 *
 * electron-updater itself is stood in for: what is pinned here is that the
 * question at a start obeys the setting, and that a cancel reaches the download
 * that is running, comes back as a cancel and not as a failure, and leaves the
 * next attempt free to run.
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

/** A download that goes on until it is told how it ended, as a real one does. */
function runningDownload() {
  let fail: (err: Error) => void = () => {};
  let finish: () => void = () => {};
  updater.downloadUpdate.mockImplementationOnce(
    () =>
      new Promise<string[]>((resolve, reject) => {
        fail = reject;
        finish = () => resolve([]);
      }),
  );
  return { fail: (err: Error) => fail(err), finish: () => finish() };
}

/** Each test gets the module afresh: what it holds is the download under way. */
async function load() {
  vi.resetModules();
  const updaterModule = await import('../src/core/updater/launcher-updater');
  updaterModule.initUpdater();
  return updaterModule;
}

const tokenOf = (call: number) =>
  updater.downloadUpdate.mock.calls[call]?.[0] as { cancelled: boolean } | undefined;

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

describe('a check that fails', () => {
  it("says so in the player's language when nothing could be reached", async () => {
    updater.checkForUpdates.mockRejectedValueOnce(new Error('net::ERR_INTERNET_DISCONNECTED'));
    const { checkForUpdates } = await load();

    expect(await checkForUpdates()).toMatchObject({
      status: 'failed',
      error: 'net::ERR_INTERNET_DISCONNECTED',
      errorMessage: { key: 'error.noConnection' },
    });
  });

  it('quotes anything else as it came', async () => {
    updater.checkForUpdates.mockRejectedValueOnce(new Error('Cannot parse the feed'));
    const { checkForUpdates } = await load();

    const result = await checkForUpdates();
    expect(result).toMatchObject({ status: 'failed', error: 'Cannot parse the feed' });
    expect(result).not.toHaveProperty('errorMessage');
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

describe('cancelling the update download', () => {
  it('reaches the download that is running, and comes back as a cancel', async () => {
    const download = runningDownload();
    const { downloadUpdate, cancelUpdateDownload } = await load();

    const ended = downloadUpdate();
    await vi.waitFor(() => expect(updater.downloadUpdate).toHaveBeenCalledTimes(1));
    expect(tokenOf(0)?.cancelled).toBe(false);

    cancelUpdateDownload();
    expect(tokenOf(0)?.cancelled).toBe(true);

    // electron-updater ends it with an error of its own, which is no failure.
    download.fail(new Error('cancelled'));
    await expect(ended).resolves.toBe('cancelled');
  });

  it('takes down the bar the download had put up', async () => {
    const download = runningDownload();
    const { downloadUpdate, cancelUpdateDownload } = await load();

    const ended = downloadUpdate();
    await vi.waitFor(() => expect(updater.downloadUpdate).toHaveBeenCalledTimes(1));
    updater.listeners.get('download-progress')?.({ percent: 40, transferred: 40, total: 100 });

    cancelUpdateDownload();
    download.fail(new Error('cancelled'));
    await ended;

    expect(sent).toContainEqual(['progress:abandoned', 'launcher-update']);
  });

  it('still reports a download that failed by itself as the failure it is', async () => {
    const download = runningDownload();
    const { downloadUpdate } = await load();

    const ended = downloadUpdate();
    await vi.waitFor(() => expect(updater.downloadUpdate).toHaveBeenCalledTimes(1));
    download.fail(new Error('socket hang up'));

    await expect(ended).rejects.toThrow('socket hang up');
  });

  it('says it downloaded when it did', async () => {
    const download = runningDownload();
    const { downloadUpdate } = await load();

    const ended = downloadUpdate();
    await vi.waitFor(() => expect(updater.downloadUpdate).toHaveBeenCalledTimes(1));
    download.finish();

    await expect(ended).resolves.toBe('downloaded');
  });

  it('leaves the next attempt a token that is not cancelled already', async () => {
    const first = runningDownload();
    const { downloadUpdate, cancelUpdateDownload } = await load();

    const cancelled = downloadUpdate();
    await vi.waitFor(() => expect(updater.downloadUpdate).toHaveBeenCalledTimes(1));
    cancelUpdateDownload();
    first.fail(new Error('cancelled'));
    await cancelled;

    const second = runningDownload();
    const ended = downloadUpdate();
    await vi.waitFor(() => expect(updater.downloadUpdate).toHaveBeenCalledTimes(2));
    expect(tokenOf(1)?.cancelled).toBe(false);
    second.finish();
    await expect(ended).resolves.toBe('downloaded');
  });

  it('has a second request join the first, so that a cancel reaches both', async () => {
    const download = runningDownload();
    const { downloadUpdate, cancelUpdateDownload } = await load();

    const first = downloadUpdate();
    const second = downloadUpdate();
    await vi.waitFor(() => expect(updater.downloadUpdate).toHaveBeenCalledTimes(1));
    cancelUpdateDownload();
    download.fail(new Error('cancelled'));

    await expect(first).resolves.toBe('cancelled');
    await expect(second).resolves.toBe('cancelled');
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it('does nothing when nothing is running', async () => {
    const { cancelUpdateDownload } = await load();
    expect(() => cancelUpdateDownload()).not.toThrow();
  });

  it('does not spoil the download after one that has ended', async () => {
    const first = runningDownload();
    const { downloadUpdate, cancelUpdateDownload } = await load();

    const ended = downloadUpdate();
    await vi.waitFor(() => expect(updater.downloadUpdate).toHaveBeenCalledTimes(1));
    first.finish();
    await ended;
    cancelUpdateDownload();

    const second = runningDownload();
    const next = downloadUpdate();
    await vi.waitFor(() => expect(updater.downloadUpdate).toHaveBeenCalledTimes(2));
    expect(tokenOf(1)?.cancelled).toBe(false);
    second.finish();
    await next;
  });
});
