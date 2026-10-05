// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

/**
 * Run `work` over every item, with at most `concurrency` in flight.
 *
 * The first failure stops the rest. `Promise.all` rejects on it either way, but
 * the other workers went on draining the queue regardless — so a launch that had
 * already failed carried on pulling the remaining few thousand assets in the
 * background, for nobody.
 */
export async function forEachConcurrently<T>(
  items: T[],
  concurrency: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  let failed = false;
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.max(1, concurrency); i++) {
    workers.push(
      (async () => {
        while (queue.length > 0 && !failed) {
          try {
            await work(queue.shift()!);
          } catch (err) {
            failed = true;
            throw err;
          }
        }
      })(),
    );
  }
  // `allSettled` first, so every worker has finished before this returns: with
  // `all` the losers stayed in flight past the rejection, writing into a
  // directory the caller believes it is done with.
  const results = await Promise.allSettled(workers);
  const firstRejection = results.find((r) => r.status === 'rejected');
  if (firstRejection) throw (firstRejection as PromiseRejectedResult).reason;
}
