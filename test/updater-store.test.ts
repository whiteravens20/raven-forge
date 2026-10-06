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
