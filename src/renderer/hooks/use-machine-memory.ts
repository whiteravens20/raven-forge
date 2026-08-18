import { useEffect, useState } from 'react';

const api = window.ravenforge;

/**
 * The machine's physical memory, in megabytes, or `undefined` while it is
 * unknown.
 *
 * Cached at module scope and fetched once per run: it is the answer to a
 * question about the hardware, it does not change while the launcher is open,
 * and the profile form would otherwise ask again on every keystroke that
 * remounts it.
 *
 * `undefined` is a real state and every caller has to mean it. It covers both
 * "the reply has not arrived yet" and "the main process could not tell us",
 * and the controls that consume this fall back to their old unbounded
 * behaviour in either case — a machine whose memory cannot be read must still
 * be a machine the launcher works on.
 */
let cached: number | undefined;
let inflight: Promise<number | undefined> | undefined;

function load(): Promise<number | undefined> {
  inflight ??= api.system.getInfo().then((result) => {
    cached = result.success && result.data ? result.data.totalMemoryMb : undefined;
    return cached;
  });
  return inflight;
}

export function useMachineMemoryMb(): number | undefined {
  const [value, setValue] = useState(cached);

  useEffect(() => {
    if (value !== undefined) return;
    let cancelled = false;
    void load().then((mb) => {
      if (!cancelled) setValue(mb);
    });
    return () => {
      cancelled = true;
    };
  }, [value]);

  return value;
}
