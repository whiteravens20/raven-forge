// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect } from 'vitest';
import { afterGameWhenClosed } from '../src/core/minecraft/game-launcher';

/**
 * "When the game starts: close", from the far end.
 *
 * The setting used to close the window when the game *exited*, from a handler
 * registered ahead of the one that records the session — so the launcher stayed
 * open all through the game, and after a crash it was gone before the crash
 * card could be drawn. Now the window is hidden at launch and this decides what
 * happens to the hidden launcher once the session is on record.
 */
describe('afterGameWhenClosed', () => {
  const hidden = { crashed: false, windowVisible: false, othersRunning: false };

  it('quits after a game that simply ended', () => {
    expect(afterGameWhenClosed(hidden)).toBe('quit');
  });

  it('comes back for a crash, so the report can be seen', () => {
    expect(afterGameWhenClosed({ ...hidden, crashed: true })).toBe('show');
  });

  it('comes back for a crash whatever else is true', () => {
    expect(afterGameWhenClosed({ crashed: true, windowVisible: true, othersRunning: true })).toBe(
      'show',
    );
  });

  it('does not quit under a player who opened the launcher again', () => {
    expect(afterGameWhenClosed({ ...hidden, windowVisible: true })).toBe('stay');
  });

  it('does not quit while another game still has a session to record', () => {
    expect(afterGameWhenClosed({ ...hidden, othersRunning: true })).toBe('stay');
  });
});
