// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

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
 * One of the sign-in services answered, and the answer was not a yes.
 *
 * It carries the status because the status is what says which kind of no. A
 * 400 from Microsoft is a refresh token that has died, and only signing in
 * again helps. A 429 from Mojang or a 503 from Xbox Live is a service that is
 * busy or broken: nothing about the account is wrong, and signing in again
 * meets the same answer. See {@link isAuthOutage}.
 */
export class AuthAnswerError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AuthAnswerError';
  }
}

/** Asked too often, taking too long, or failing on its own side. */
function isServiceTrouble(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Whether signing in failed for a reason that is not the account's: nothing
 * answered, or what answered said it could not serve anyone just now.
 *
 * The second half was missing. Mojang's sign-in limits how often it may be
 * asked, and Xbox Live has its bad hours; either one was reported as a session
 * that had expired, to be put right by signing in again — which then failed in
 * the same way, while the offer that would have worked, playing offline, was
 * not made.
 */
export function isAuthOutage(err: unknown): boolean {
  if (isNetworkFailure(err)) return true;

  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current instanceof AuthAnswerError && isServiceTrouble(current.status)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
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
      code === 'CERT_HAS_EXPIRED' ||
      // The configured SOCKS proxy did not get the request through.
      code === 'ERR_SOCKS_PROXY'
    ) {
      return true;
    }
    if ((current as { name?: string }).name === 'TimeoutError') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
