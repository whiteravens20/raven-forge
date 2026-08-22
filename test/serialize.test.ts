import { describe, it, expect } from 'vitest';
import { serializeByKey } from '../src/core/util/serialize';

/**
 * The queue behind every read-modify-write of a launcher state file.
 *
 * What matters is not that it is a queue but that it is the *right* queue: one
 * per file, surviving a failed turn, and not accumulating an entry per key the
 * process ever touched.
 */

/** Resolves after `ms`, without pulling in fake timers for a few real ones. */
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('serializeByKey', () => {
  it('runs work for one key strictly one at a time', async () => {
    const events: string[] = [];
    const turn = (name: string, ms: number) =>
      serializeByKey('same', async () => {
        events.push(`${name}:start`);
        await wait(ms);
        events.push(`${name}:end`);
      });

    // The slow one first: without serialization it would still be running when
    // the fast one finishes, and the events would interleave.
    await Promise.all([turn('a', 20), turn('b', 1)]);

    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('does not make one key wait for another', async () => {
    let bStarted = false;
    const a = serializeByKey('a', async () => {
      await wait(20);
      return bStarted;
    });
    const b = serializeByKey('b', async () => {
      bStarted = true;
    });

    await b;
    expect(await a).toBe(true);
  });

  it('keeps the queue running after a turn rejects', async () => {
    const failing = serializeByKey('same', () => Promise.reject(new Error('boom')));
    const after = serializeByKey('same', () => Promise.resolve('ran'));

    await expect(failing).rejects.toThrow('boom');
    expect(await after).toBe('ran');
  });

  it('hands the rejection to the caller that caused it, not to the next one', async () => {
    const first = serializeByKey('same', () => Promise.reject(new Error('mine')));
    const second = serializeByKey('same', () => Promise.resolve('clean'));

    await expect(first).rejects.toThrow('mine');
    await expect(second).resolves.toBe('clean');
  });

  it('serializes work queued from inside an earlier turn', async () => {
    const events: string[] = [];
    await serializeByKey('same', async () => {
      events.push('outer:start');
      await wait(5);
      events.push('outer:end');
    });
    await serializeByKey('same', () => {
      events.push('later');
      return Promise.resolve();
    });
    expect(events).toEqual(['outer:start', 'outer:end', 'later']);
  });
});
