// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect } from 'vitest';
import { endedInFailure } from '../src/core/minecraft/game-launcher';

/**
 * Whether the way a game ended gets a crash card and a crash report.
 *
 * Both wrong answers were being given. Pressing Stop was a crash, because a JVM
 * answers SIGTERM by shutting down and exiting 143; and a game the kernel killed
 * for memory was a clean exit, because a process that dies of a signal has no
 * exit code and "no code" was read as "no problem".
 */
describe('endedInFailure', () => {
  it('takes a zero exit for what it is', () => {
    expect(endedInFailure(0, null, false)).toBe(false);
  });

  it('calls any other exit code a failure', () => {
    expect(endedInFailure(1, null, false)).toBe(true);
    expect(endedInFailure(-1, null, false)).toBe(true);
    // 143 with nobody having asked: something else sent the SIGTERM.
    expect(endedInFailure(143, null, false)).toBe(true);
  });

  it('calls a game that a signal killed a failure, though it has no exit code', () => {
    // The out-of-memory killer, then two native crashes.
    expect(endedInFailure(null, 'SIGKILL', false)).toBe(true);
    expect(endedInFailure(null, 'SIGABRT', false)).toBe(true);
    expect(endedInFailure(null, 'SIGSEGV', false)).toBe(true);
  });

  it('never calls a stop the player asked for a failure, however it shows up', () => {
    // The JVM's own SIGTERM handler ran: 128 + 15.
    expect(endedInFailure(143, null, true)).toBe(false);
    // It died of the signal instead, or of the SIGKILL that follows the grace period.
    expect(endedInFailure(null, 'SIGTERM', true)).toBe(false);
    expect(endedInFailure(null, 'SIGKILL', true)).toBe(false);
    // Windows: the stop is TerminateProcess, and the exit code is the caller's.
    expect(endedInFailure(1, null, true)).toBe(false);
  });
});
