// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installRendererApi } from './helpers/renderer-api';

/**
 * What the renderer believes about the games it started.
 *
 * Every button that starts, stops or cancels a game reads this store, so a
 * wrong belief here is a wrong button on screen: Play offered for a game that
 * is running, a spinner over one that failed minutes ago.
 */

let api: ReturnType<typeof installRendererApi>;

async function loadStore() {
  const { useGameStore } = await import('../src/renderer/stores/game-store');
  return useGameStore;
}

beforeEach(() => {
  vi.resetModules();
  api = installRendererApi();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('which games are running', () => {
  it('is asked of the main process when the store starts', async () => {
    // The page reloads when the error screen's button is pressed, and the old
    // page's record goes with it. Fed by events alone, the new one came back
    // offering Play for a game that was up, and no way to stop it.
    api.call('game', 'getRunning').mockResolvedValue({ success: true, data: ['a', 'b'] });

    const store = await loadStore();

    await vi.waitFor(() => expect([...store.getState().running]).toEqual(['a', 'b']));
  });

  it('follows the events from then on', async () => {
    const store = await loadStore();

    api.emit('game:started', 'a');
    expect(store.getState().running.has('a')).toBe(true);

    api.emit('game:exited', { profileId: 'a', exitCode: 0, crashed: false, playTimeMinutes: 3 });
    expect(store.getState().running.has('a')).toBe(false);
  });

  it('keeps a game that started while the question was still out', async () => {
    let answer: (running: string[]) => void = () => {};
    api.call('game', 'getRunning').mockReturnValue(
      new Promise((resolve) => {
        answer = (running) => resolve({ success: true, data: running });
      }),
    );
    const store = await loadStore();

    api.emit('game:started', 'b');
    answer(['a']);

    await vi.waitFor(() => expect([...store.getState().running].sort()).toEqual(['a', 'b']));
  });
});
