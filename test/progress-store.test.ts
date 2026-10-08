// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installRendererApi } from './helpers/renderer-api';

/**
 * What the progress window believes is still going on.
 */

let api: ReturnType<typeof installRendererApi>;

async function loadStore() {
  const { useProgressStore } = await import('../src/renderer/stores/progress-store');
  useProgressStore.getState().init();
  return useProgressStore;
}

const step = (operationId: string, progress: number, installing = false) => ({
  operationId,
  progress,
  message: { text: operationId },
  installing,
});

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  api = installRendererApi();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('an operation that ends without finishing', () => {
  it('loses its bar at once, and the window with it when it was the last', async () => {
    // It used to stay, frozen at 40%, until the launcher was restarted.
    const store = await loadStore();
    api.emit('progress:game-assets', step('assets-1.21.1', 0.4, true));
    expect(store.getState().hasActive).toBe(true);

    api.emit('progress:abandoned', 'assets-1.21.1');

    expect(store.getState().entries.size).toBe(0);
    expect(store.getState().hasActive).toBe(false);
    // And the next thing shown is not called an install because this one was.
    expect(store.getState().installing).toBe(false);
  });

  it('leaves the other bars where they are', async () => {
    const store = await loadStore();
    api.emit('progress:game-assets', step('assets-1.21.1', 0.4));
    api.emit('progress:launcher-update', step('launcher-update', 0.7));

    api.emit('progress:abandoned', 'assets-1.21.1');

    expect([...store.getState().entries.keys()]).toEqual(['launcher-update']);
    expect(store.getState().hasActive).toBe(true);
  });
});

describe('an operation that finishes', () => {
  it('keeps its bar a moment at the end and then lets it go', async () => {
    const store = await loadStore();
    api.emit('progress:mod-sync', step('p1', 1));
    expect(store.getState().entries.size).toBe(1);

    vi.advanceTimersByTime(1500);

    expect(store.getState().entries.size).toBe(0);
  });
});
