// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

/**
 * What went wrong, and what was underneath it.
 *
 * Node reports every failed request as `TypeError: fetch failed` and keeps the
 * reason — the host that would not resolve, the connection that was refused —
 * on `cause`. An error turned into text by its message alone therefore says the
 * same two words for all of them, and that was every network failure in the
 * launcher's log and on its screens.
 *
 * Only the name, the message and the code are read. A cause can be an object
 * with a great deal more on it — the SOCKS client's errors carry the proxy's
 * password — and none of that belongs in a log.
 */

/** How far down a chain of causes is followed. Nothing real is this deep. */
const MAX_CAUSES = 5;

function said(err: Error): string {
  const code = (err as { code?: unknown }).code;
  // An `AggregateError` from a connection tried over several addresses has no
  // message at all; its code is the whole of what it knows.
  const text = err.message || (typeof code === 'string' ? code : err.name);
  return typeof code === 'string' && !text.includes(code) ? `${text} (${code})` : text;
}

/** An error's message followed by its causes: `fetch failed: connect ECONNREFUSED …`. */
export function errorText(err: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();

  let current = err;
  while (current !== undefined && current !== null && parts.length < MAX_CAUSES) {
    if (seen.has(current)) break;
    seen.add(current);
    if (!(current instanceof Error)) {
      parts.push(String(current));
      break;
    }
    const text = said(current);
    // A wrapper that already quotes what it wraps would say it twice.
    if (!parts.some((part) => part.includes(text))) parts.push(text);
    current = current.cause;
  }

  return parts.join(': ');
}

/**
 * The arguments of a log call, with each error that has a cause followed by it.
 *
 * The log writes an error as its stack, and a stack does not include the cause.
 */
export function withCauses(args: unknown[]): unknown[] {
  return args.map((arg) => {
    if (!(arg instanceof Error) || arg.cause === undefined || arg.cause === null) return arg;
    return `${arg.stack ?? String(arg)}\n    caused by: ${errorText(arg.cause)}`;
  });
}
