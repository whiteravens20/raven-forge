/**
 * Telling "we could not reach the auth servers" apart from "the auth servers
 * said no".
 *
 * The two look identical from a `fetch` that rejects, but they lead opposite
 * places: unreachable is recoverable by launching offline, rejected means the
 * refresh token is dead and only a fresh login helps. Offering "continue
 * offline" for a rejected login would be a dead end, and telling someone on a
 * flaky connection to log in again is worse — it makes them re-enter credentials
 * to fix a problem credentials had nothing to do with.
 */
export class AuthServersUnreachableError extends Error {
  constructor(cause?: unknown) {
    super('Could not reach the Microsoft or Mojang auth servers');
    this.name = 'AuthServersUnreachableError';
    this.cause = cause;
  }
}

/**
 * Node's fetch reports every transport failure as a `TypeError: fetch failed`
 * with the real reason on `cause`, so the DNS/connection/TLS codes have to be
 * dug out rather than matched on the message.
 */
export function isNetworkFailure(err: unknown): boolean {
  if (err instanceof AuthServersUnreachableError) return true;
  if (err instanceof DOMException && err.name === 'TimeoutError') return true;

  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current && !seen.has(current)) {
    seen.add(current);
    const code = (current as { code?: string }).code;
    if (
      code === 'ENOTFOUND' ||
      code === 'EAI_AGAIN' ||
      code === 'ECONNREFUSED' ||
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      code === 'EHOSTUNREACH' ||
      code === 'ENETUNREACH' ||
      code === 'UND_ERR_CONNECT_TIMEOUT' ||
      code === 'UND_ERR_SOCKET' ||
      code === 'CERT_HAS_EXPIRED'
    ) {
      return true;
    }
    if ((current as { name?: string }).name === 'TimeoutError') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
