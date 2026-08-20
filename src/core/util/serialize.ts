/**
 * Run work one item at a time per key.
 *
 * `profiles.json` has had this since a game exiting mid-edit lost one of the two
 * writes; the launcher's other state files did not, and `installed.lock` is
 * written by six different paths — the manifest sync, a hand install, an
 * uninstall, a toggle, the update check, the update itself. Every one of them is
 * a read, some `await`s, and a write of the whole array, so two overlapping ones
 * lose whatever the other did in between.
 *
 * Keyed rather than global because the contention is per file: two profiles
 * syncing at once have no reason to wait for each other.
 *
 * The chain survives a rejected turn — the next one still runs — and the entry
 * is dropped once nothing is queued behind it, so a launcher left open for a
 * week does not accumulate one promise per profile it ever touched.
 */
const chains = new Map<string, Promise<unknown>>();

export function serializeByKey<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  const started = previous.then(work, work);

  const settled = started.then(
    () => undefined,
    () => undefined,
  );
  chains.set(key, settled);
  void settled.then(() => {
    // Only if nothing else queued behind it in the meantime; otherwise this
    // would drop the tail the next caller is waiting on.
    if (chains.get(key) === settled) chains.delete(key);
  });

  return started;
}
