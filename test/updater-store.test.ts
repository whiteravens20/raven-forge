// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installRendererApi } from './helpers/renderer-api';

/**
 * What the renderer believes about a launcher update.
 *
 * Three places act on it — the notification, the Play button and the Settings
 * page — and each used to keep its own belief. "Later" was heard by one of the
 * three, and a check made from Settings put a finished download back to the
 * beginning for the other two.
 */

let api: ReturnType<typeof installRendererApi>;

async function loadStore() {
  const { useUpdaterStore } = await import('../src/renderer/stores/updater-store');
  return useUpdaterStore;
}

beforeEach(() => {
  vi.resetModules();
  api = installRendererApi();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const update = (version = '0.8.0') => ({ version });

describe('an update found before the page was listening', () => {
  it('is announced all the same', async () => {
    api.call('updater', 'getPending').mockResolvedValueOnce({ success: true, data: update() });

    const store = await loadStore();

    await vi.waitFor(() => expect(store.getState().available).toEqual(update()));
  });

  it('does not overrule what an event has said in the meantime', async () => {
    let answer = (_value: { success: boolean; data: { version: string } }) => {};
    api.call('updater', 'getPending').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );

    const store = await loadStore();
    api.emit('updater:update-available', update('0.8.1'));
    answer({ success: true, data: update('0.8.0') });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(store.getState().available).toEqual(update('0.8.1'));
  });

  it('leaves nothing announced when nothing was found', async () => {
    api.call('updater', 'getPending').mockResolvedValueOnce({ success: true, data: null });

    const store = await loadStore();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(store.getState().available).toBeNull();
  });
});

describe('an update that has been announced', () => {
  it('is put off by "later" until the next one, and stays known', async () => {
    const store = await loadStore();
    api.emit('updater:update-available', update());

    store.getState().postpone();

    // Still known — Settings goes on offering it — and no longer in the way.
    expect(store.getState()).toMatchObject({ available: update(), postponed: true });
  });

  it('stays put off when a later check announces the same version again', async () => {
    const store = await loadStore();
    api.emit('updater:update-available', update());
    store.getState().postpone();

    api.emit('updater:update-available', update());

    expect(store.getState().postponed).toBe(true);
  });

  it('is offered again when a newer version turns up', async () => {
    const store = await loadStore();
    api.emit('updater:update-available', update('0.8.0'));
    store.getState().postpone();

    api.emit('updater:update-available', update('0.8.1'));

    expect(store.getState()).toMatchObject({ available: update('0.8.1'), postponed: false });
  });
});

describe('downloading an update', () => {
  it('ends ready to install', async () => {
    const store = await loadStore();
    api.emit('updater:update-available', update());

    await expect(store.getState().download()).resolves.toBe(true);

    expect(store.getState().stage).toBe('ready');
  });

  it('is one download however many places ask for it', async () => {
    // The notification's button and Play, pressed one after the other.
    const store = await loadStore();
    api.emit('updater:update-available', update());

    await Promise.all([store.getState().download(), store.getState().download()]);

    expect(api.call('updater', 'download')).toHaveBeenCalledTimes(1);
  });

  it('is not sent back to the start by a check that finds the same update', async () => {
    // "Check for updates" in Settings, with the file already downloaded. Both
    // other places used to drop back to offering the download.
    const store = await loadStore();
    api.emit('updater:update-available', update());
    await store.getState().download();

    api.emit('updater:update-available', update());

    expect(store.getState().stage).toBe('ready');
    await store.getState().download();
    expect(api.call('updater', 'download')).toHaveBeenCalledTimes(1);
  });

  it('follows the progress the main process reports', async () => {
    const store = await loadStore();
    api.emit('updater:update-available', update());

    api.emit('progress:launcher-update', { operationId: 'launcher-update', progress: 0.42 });

    expect(store.getState().percent).toBe(42);
  });

  it('says why when it fails, and can be tried again', async () => {
    const store = await loadStore();
    api.emit('updater:update-available', update());
    api
      .call('updater', 'download')
      .mockResolvedValueOnce({ success: false, error: 'net::ERR_INTERNET_DISCONNECTED' });

    await expect(store.getState().download()).resolves.toBe(false);
    expect(store.getState()).toMatchObject({
      stage: 'failed',
      error: 'net::ERR_INTERNET_DISCONNECTED',
    });

    await expect(store.getState().download()).resolves.toBe(true);
    expect(store.getState()).toMatchObject({ stage: 'ready', error: null });
  });

  it('does nothing when there is no update to download', async () => {
    const store = await loadStore();

    await expect(store.getState().download()).resolves.toBe(false);
    expect(api.call('updater', 'download')).not.toHaveBeenCalled();
  });
});

describe('installing an update', () => {
  it('reports a restart that did not happen instead of swallowing it', async () => {
    const store = await loadStore();
    api.emit('updater:update-downloaded', update());
    api.call('updater', 'install').mockResolvedValueOnce({ success: false, error: 'EPERM' });

    await expect(store.getState().install()).resolves.toBe(false);

    expect(store.getState().error).toBe('EPERM');
  });
});

describe('a download that fails', () => {
  it('keeps what the main process said, for the page to quote', async () => {
    const store = await loadStore();
    api.emit('updater:update-available', update());
    api.call('updater', 'download').mockResolvedValueOnce({ success: false, error: 'disk full' });

    await expect(store.getState().download()).resolves.toBe(false);

    expect(store.getState()).toMatchObject({ stage: 'failed', error: 'disk full' });
  });

  it("says a lost connection in the player's language, and not in Chromium's", async () => {
    const store = await loadStore();
    api.emit('updater:update-available', update());
    api.call('updater', 'download').mockResolvedValueOnce({
      success: false,
      error: 'net::ERR_INTERNET_DISCONNECTED',
      errorMessage: { key: 'error.noConnection' },
    });

    await store.getState().download();

    expect(store.getState().stage).toBe('failed');
    expect(store.getState().error).not.toContain('net::');
    expect(store.getState().error).toBeTruthy();
  });
});

describe('cancelling the download', () => {
  it('goes back to offering the update, with nothing held against it', async () => {
    const store = await loadStore();
    api.emit('updater:update-available', update());
    api.call('updater', 'download').mockResolvedValueOnce({ success: true, data: 'cancelled' });

    await expect(store.getState().download()).resolves.toBe(false);

    expect(store.getState()).toMatchObject({
      available: update(),
      stage: 'idle',
      percent: 0,
      error: null,
    });
  });

  it('asks the main process to stop, and leaves the outcome to the download', async () => {
    const store = await loadStore();
    api.emit('updater:update-available', update());
    let finish = (_value: { success: boolean; data: string }) => {};
    api.call('updater', 'download').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );

    const downloading = store.getState().download();
    store.getState().cancelDownload();

    expect(api.call('updater', 'cancelDownload')).toHaveBeenCalledTimes(1);
    expect(store.getState().stage).toBe('downloading');

    finish({ success: true, data: 'cancelled' });
    await downloading;
    expect(store.getState().stage).toBe('idle');
  });

  it('lets the same update be downloaded again', async () => {
    const store = await loadStore();
    api.emit('updater:update-available', update());
    api.call('updater', 'download').mockResolvedValueOnce({ success: true, data: 'cancelled' });
    await store.getState().download();

    api.call('updater', 'download').mockResolvedValueOnce({ success: true, data: 'downloaded' });

    await expect(store.getState().download()).resolves.toBe(true);
    expect(store.getState().stage).toBe('ready');
  });
});
