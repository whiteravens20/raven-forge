// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installRendererApi } from './helpers/renderer-api';
import type { ErrorMessage } from '../src/shared/ipc-types';

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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A call that stays out until the test answers it. */
function pending<T>() {
  let settle: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

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

describe('launching', () => {
  it('holds the profile as preparing for exactly as long as the call is out', async () => {
    const call = pending<{ success: boolean }>();
    api.call('game', 'launch').mockReturnValue(call.promise);
    const store = await loadStore();

    const launched = store.getState().launch('a', { quickConnect: true });
    expect(store.getState().preparing.has('a')).toBe(true);
    expect(api.call('game', 'launch')).toHaveBeenCalledWith({ profileId: 'a', quickConnect: true });

    call.settle({ success: true });
    await launched;
    expect(store.getState().preparing.has('a')).toBe(false);
    expect(store.getState().failures).toEqual({});
  });

  it('does not start a second launch of a profile that is already on its way', async () => {
    api.call('game', 'launch').mockReturnValue(pending<{ success: boolean }>().promise);
    const store = await loadStore();

    void store.getState().launch('a');
    void store.getState().launch('a');

    expect(api.call('game', 'launch')).toHaveBeenCalledTimes(1);
  });

  it('keeps an unreachable sign-in apart from every other failure', async () => {
    // The one failure with a way round it — launching offline — and the offer
    // has to know whether the launch it interrupted was a quick connect.
    api.call('game', 'launch').mockResolvedValue({ success: false, code: 'AUTH_UNREACHABLE' });
    const store = await loadStore();

    await store.getState().launch('a', { quickConnect: true });

    expect(store.getState().failures.a).toEqual({ kind: 'auth-unreachable', quickConnect: true });
  });

  it('keeps a refusal as the key it came with, to be said in the player’s language', async () => {
    const message: ErrorMessage = { key: 'launchError.ramTooBig', vars: { allocated: '64 GB' } };
    api
      .call('game', 'launch')
      .mockResolvedValue({ success: false, error: 'RAM', errorMessage: message });
    const store = await loadStore();

    await store.getState().launch('a');

    expect(store.getState().failures.a).toEqual({ kind: 'refused', message });
  });

  it('keeps any other failure with the reason main gave', async () => {
    api.call('game', 'launch').mockResolvedValue({ success: false, error: 'No active account' });
    const store = await loadStore();

    await store.getState().launch('a');

    expect(store.getState().failures.a).toEqual({
      kind: 'launch-failed',
      error: 'No active account',
    });
    expect(store.getState().preparing.has('a')).toBe(false);
  });

  it('records a call that threw as a failure too, and frees the button', async () => {
    api.call('game', 'launch').mockRejectedValue(new Error('channel closed'));
    const store = await loadStore();

    await store.getState().launch('a');

    expect(store.getState().failures.a).toEqual({ kind: 'launch-failed' });
    expect(store.getState().preparing.has('a')).toBe(false);
  });

  it('files a failure under the profile it happened to, and nowhere else', async () => {
    // It used to be one line of state in the home page: a failure of profile A
    // stayed on screen after the selector had moved to B.
    api.call('game', 'launch').mockResolvedValue({ success: false, error: 'boom' });
    const store = await loadStore();

    await store.getState().launch('a');

    expect(store.getState().failures.b).toBeUndefined();
  });

  it('clears the last failure when the profile is launched again', async () => {
    api.call('game', 'launch').mockResolvedValueOnce({ success: false, error: 'boom' });
    const store = await loadStore();
    await store.getState().launch('a');
    expect(store.getState().failures.a).toBeDefined();

    await store.getState().launch('a');

    expect(store.getState().failures.a).toBeUndefined();
  });
});

describe('cancelling a launch', () => {
  it('keeps asking until something stops, and frees nothing before the launch lets go', async () => {
    // `false` is main saying it had no job for the profile at that instant: it
    // is between two of them. Taking that as final freed the button while the
    // launch went on and started the game.
    vi.useFakeTimers();
    const launch = pending<{ success: boolean }>();
    api.call('game', 'launch').mockReturnValue(launch.promise);
    api
      .call('game', 'cancel')
      .mockResolvedValueOnce({ success: true, data: false })
      .mockResolvedValueOnce({ success: true, data: false })
      .mockResolvedValue({ success: true, data: true });
    const store = await loadStore();
    const launched = store.getState().launch('a');

    const cancelled = store.getState().cancelLaunch('a');
    await vi.runAllTimersAsync();
    await cancelled;

    expect(api.call('game', 'cancel')).toHaveBeenCalledTimes(3);
    // Stopped, but main has not resolved the launch call yet — and until it
    // does, it would refuse a second launch of this profile.
    expect(store.getState().preparing.has('a')).toBe(true);
    expect(store.getState().cancelling.has('a')).toBe(true);

    launch.settle({ success: true });
    await launched;
    expect(store.getState().preparing.has('a')).toBe(false);
    expect(store.getState().cancelling.has('a')).toBe(false);
  });

  it('gives up asking once the launch has ended by itself', async () => {
    vi.useFakeTimers();
    const launch = pending<{ success: boolean }>();
    api.call('game', 'launch').mockReturnValue(launch.promise);
    api.call('game', 'cancel').mockResolvedValue({ success: true, data: false });
    const store = await loadStore();
    const launched = store.getState().launch('a');

    const cancelled = store.getState().cancelLaunch('a');
    await vi.advanceTimersByTimeAsync(600);
    launch.settle({ success: true });
    await launched;
    await vi.runAllTimersAsync();
    await cancelled;

    const asked = api.call('game', 'cancel').mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.call('game', 'cancel')).toHaveBeenCalledTimes(asked);
  });

  it('does not carry over into the launch after the one it was pressed for', async () => {
    vi.useFakeTimers();
    const first = pending<{ success: boolean }>();
    const second = pending<{ success: boolean }>();
    api
      .call('game', 'launch')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    api.call('game', 'cancel').mockResolvedValue({ success: true, data: false });
    const store = await loadStore();

    const launched = store.getState().launch('a');
    const cancelled = store.getState().cancelLaunch('a');
    await vi.advanceTimersByTimeAsync(100);
    first.settle({ success: true });
    await launched;

    // Pressed again before the old cancel has woken up from its wait.
    void store.getState().launch('a');
    const asked = api.call('game', 'cancel').mock.calls.length;
    await vi.runAllTimersAsync();
    await cancelled;

    expect(api.call('game', 'cancel')).toHaveBeenCalledTimes(asked);
    expect(store.getState().cancelling.has('a')).toBe(false);
  });

  it('does nothing for a profile that is not being launched', async () => {
    const store = await loadStore();

    await store.getState().cancelLaunch('a');

    expect(api.call('game', 'cancel')).not.toHaveBeenCalled();
    expect(store.getState().cancelling.has('a')).toBe(false);
  });
});

describe('stopping a game', () => {
  it('says so when the game could not be stopped', async () => {
    api.call('game', 'kill').mockResolvedValue({ success: false, error: 'Game is not running' });
    const store = await loadStore();

    await store.getState().stop('a');

    expect(store.getState().failures.a).toEqual({
      kind: 'stop-failed',
      error: 'Game is not running',
    });
    expect(store.getState().stopping.has('a')).toBe(false);
  });

  it('leaves the game listed as running until its own exit says otherwise', async () => {
    const store = await loadStore();
    api.emit('game:started', 'a');

    await store.getState().stop('a');

    expect(store.getState().running.has('a')).toBe(true);
  });
});

describe('a game that went down', () => {
  const crash = { profileId: 'a', exitCode: 1, crashed: true, playTimeMinutes: 0 };

  it('is kept under its profile, for whichever page shows that profile', async () => {
    // Two pages draw the crash card, and a game is not always looked for on the
    // page it was started from: the record is the profile's, not a page's.
    const store = await loadStore();
    api.emit('game:started', 'a');

    api.emit('game:exited', crash);

    expect(store.getState().getCrashInfo('a')).toEqual(crash);
    expect(store.getState().getCrashInfo('b')).toBeUndefined();
  });

  it('is not what a game that simply closed leaves', async () => {
    const store = await loadStore();
    api.emit('game:started', 'a');

    api.emit('game:exited', { ...crash, exitCode: 0, crashed: false });

    expect(store.getState().getCrashInfo('a')).toBeUndefined();
  });

  it('is put away by dismissing it, on every page at once', async () => {
    const store = await loadStore();
    api.emit('game:exited', crash);

    store.getState().clearCrash('a');

    expect(store.getState().getCrashInfo('a')).toBeUndefined();
  });

  it('is put away by the next launch of that profile, and by no other', async () => {
    api.call('game', 'launch').mockResolvedValue({ success: true });
    const store = await loadStore();
    api.emit('game:exited', crash);

    await store.getState().launch('b');
    expect(store.getState().getCrashInfo('a')).toEqual(crash);

    await store.getState().launch('a');
    expect(store.getState().getCrashInfo('a')).toBeUndefined();
  });
});
