import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Stopping a job that is already running.
 *
 * Preparing a launch runs for minutes — a JRE, thousands of assets, a pack's
 * worth of jars — and before this the only way out was to kill the launcher,
 * which left half-written files behind. The registry is keyed by profile id and
 * the UI aborts by id over IPC, so the two things that must hold are that the
 * id in the map is the job actually running, and that a job which has ended
 * cannot be cancelled by a stale reference.
 */

vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

const {
  beginJob,
  endJob,
  cancelJob,
  withTimeout,
  throwIfCancelled,
  isCancellation,
  CancelledError,
} = await import('../src/core/util/cancellation');

beforeEach(() => {
  // Every test starts with nothing registered; ids are per-test so this is
  // belt and braces rather than shared state being untangled.
  for (const id of ['p1', 'p2']) endJob(id);
});

describe('beginJob / cancelJob', () => {
  it('hands out a signal that is not yet aborted', () => {
    expect(beginJob('p1').aborted).toBe(false);
  });

  it('aborts the signal when the job is cancelled by id', () => {
    const signal = beginJob('p1');
    expect(cancelJob('p1')).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(isCancellation(signal.reason)).toBe(true);
  });

  it('reports that there was nothing to cancel', () => {
    expect(cancelJob('p1')).toBe(false);
  });

  it('does not cancel a job that has already ended', () => {
    const signal = beginJob('p1');
    endJob('p1');
    expect(cancelJob('p1')).toBe(false);
    expect(signal.aborted).toBe(false);
  });

  it('aborts a stale job rather than leaving the new one uncancellable', () => {
    // The map holds one controller per profile. Without this the second job
    // would overwrite the first and then be cancelled by an id that no longer
    // pointed at it — a launch nothing could stop.
    const first = beginJob('p1');
    const second = beginJob('p1');
    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(false);
    expect(cancelJob('p1')).toBe(true);
    expect(second.aborted).toBe(true);
  });

  it('keeps profiles apart', () => {
    const one = beginJob('p1');
    const two = beginJob('p2');
    cancelJob('p1');
    expect(one.aborted).toBe(true);
    expect(two.aborted).toBe(false);
  });
});

describe('isCancellation', () => {
  it('recognises its own error', () => {
    expect(isCancellation(new CancelledError('Download'))).toBe(true);
  });

  it("recognises the platform's AbortError", () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(isCancellation(err)).toBe(true);
  });

  it('does not mistake an ordinary failure for a cancellation', () => {
    // The whole point of the distinction: a genuine failure must still be
    // reported to the player, not swallowed as "you asked me to stop".
    expect(isCancellation(new Error('ENOSPC: no space left on device'))).toBe(false);
    expect(isCancellation('cancelled')).toBe(false);
    expect(isCancellation(undefined)).toBe(false);
  });
});

describe('throwIfCancelled', () => {
  it('passes when there is no signal at all', () => {
    expect(() => throwIfCancelled(undefined, 'Download')).not.toThrow();
  });

  it('passes while the job is live', () => {
    expect(() => throwIfCancelled(beginJob('p1'), 'Download')).not.toThrow();
  });

  it('throws a cancellation once the job is aborted', () => {
    const signal = beginJob('p1');
    cancelJob('p1');
    expect(() => throwIfCancelled(signal, 'Download')).toThrow(/Download cancelled/);
  });
});

describe('withTimeout', () => {
  it('fires on the timeout when no job signal is given', async () => {
    const signal = withTimeout(undefined, 5);
    await new Promise((r) => setTimeout(r, 30));
    expect(signal.aborted).toBe(true);
  });

  it('fires on the job being cancelled, without waiting out the timeout', () => {
    // `AbortSignal.any` is what makes a cancelled launch drop its in-flight
    // request now rather than in fifteen seconds.
    const job = beginJob('p1');
    const combined = withTimeout(job, 60_000);
    cancelJob('p1');
    expect(combined.aborted).toBe(true);
  });

  it('leaves the combined signal alone while neither has fired', () => {
    expect(withTimeout(beginJob('p1'), 60_000).aborted).toBe(false);
  });
});
