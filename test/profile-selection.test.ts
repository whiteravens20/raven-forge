// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installRendererApi } from './helpers/renderer-api';

/**
 * Which profile the launcher opens on.
 *
 * The first one in the list, every time, whatever had been played the evening
 * before — so somebody with three profiles re-selected theirs at every start.
 */

let api: ReturnType<typeof installRendererApi>;
let stored: Map<string, string>;

const profiles = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

async function loadStore() {
  const { useProfileStore } = await import('../src/renderer/stores/profile-store');
  return useProfileStore;
}

beforeEach(() => {
  vi.resetModules();
  api = installRendererApi();
  api.call('profiles', 'getAll').mockResolvedValue({ success: true, data: profiles });
  stored = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the selected profile', () => {
  it('is the first one when nothing has been selected before', async () => {
    const store = await loadStore();
    await store.getState().load();
    expect(store.getState().selectedProfileId).toBe('a');
  });

  it('is the one that was selected last time', async () => {
    const first = await loadStore();
    await first.getState().load();
    first.getState().select('c');

    // The launcher is closed and opened again.
    vi.resetModules();
    const again = await loadStore();
    await again.getState().load();

    expect(again.getState().selectedProfileId).toBe('c');
  });

  it('falls back to the first one when the remembered profile is gone', async () => {
    stored.set('rf-selected-profile', 'deleted-since');
    const store = await loadStore();
    await store.getState().load();
    expect(store.getState().selectedProfileId).toBe('a');
  });

  it('is remembered when it changes by creating a profile, not only by a click', async () => {
    const store = await loadStore();
    await store.getState().load();
    api.call('profiles', 'create').mockResolvedValueOnce({ success: true, data: { id: 'new' } });

    await store.getState().create({ name: 'New' } as never);

    expect(stored.get('rf-selected-profile')).toBe('new');
  });

  it('carries on when the page has no storage to remember in', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('storage is disabled');
      },
      setItem: () => {
        throw new Error('storage is disabled');
      },
    });
    const store = await loadStore();
    await store.getState().load();
    store.getState().select('b');
    expect(store.getState().selectedProfileId).toBe('b');
  });
});
