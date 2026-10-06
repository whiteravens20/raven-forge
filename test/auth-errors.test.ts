// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect } from 'vitest';
import net from 'node:net';
import { fetch as fetchThrough } from 'undici';
import { AuthServersUnreachableError, isNetworkFailure } from '../src/core/auth/auth-errors';
import { createSocksDispatcher } from '../src/core/net/socks-dispatcher';

/**
 * This predicate decides which of two very different things a user is told:
 * "you are offline, want to play anyway?" or "log in again". Getting it
 * backwards either sends someone to re-enter credentials over a flaky
 * connection, or offers an offline launch that will not fix a dead refresh
 * token. Both are worse than the honest answer.
 */
describe('isNetworkFailure', () => {
  it('recognises its own error type', () => {
    expect(isNetworkFailure(new AuthServersUnreachableError())).toBe(true);
  });

  it('digs the code out of a wrapped fetch failure', () => {
    // Node's fetch reports every transport fault as `TypeError: fetch failed`
    // and hides the real reason on `cause`, so the message says nothing.
    const wrapped = new TypeError('fetch failed');
    (wrapped as { cause?: unknown }).cause = Object.assign(new Error('getaddrinfo ENOTFOUND'), {
      code: 'ENOTFOUND',
    });
    expect(isNetworkFailure(wrapped)).toBe(true);
  });

  it.each([
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_SOCKET',
    'CERT_HAS_EXPIRED',
    'ERR_SOCKS_PROXY',
  ])('treats %s as unreachable', (code) => {
    expect(isNetworkFailure(Object.assign(new Error('boom'), { code }))).toBe(true);
  });

  it('recognises a SOCKS proxy that is not there', async () => {
    // The proxy client's own errors carry no code, so a proxy that had gone
    // away read as the auth servers saying no: "log in again", with no offer to
    // play offline, for something a password has nothing to do with.
    const closed = net.createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const { port } = closed.address() as net.AddressInfo;
    await new Promise<void>((resolve) => closed.close(() => resolve()));

    const dispatcher = createSocksDispatcher(`socks5://jan:hunter2@127.0.0.1:${port}`);
    const err = await fetchThrough('https://login.example.net/', { dispatcher }).catch(
      (e: unknown) => e,
    );
    await dispatcher.close();

    expect(isNetworkFailure(err)).toBe(true);
    // The client's error holds the options it was made with, the proxy's
    // password among them. What is passed on does not.
    expect((err as { cause?: unknown }).cause).not.toHaveProperty('options');
  });

  it('recognises an AbortSignal.timeout rejection', () => {
    expect(isNetworkFailure(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))).toBe(
      true,
    );
  });

  it('walks a chain of causes', () => {
    const deep = Object.assign(new Error('socket'), { code: 'ECONNRESET' });
    const mid = Object.assign(new Error('layer'), { cause: deep });
    expect(isNetworkFailure(new TypeError('fetch failed', { cause: mid }))).toBe(true);
  });

  it('does NOT treat a rejected login as unreachable', () => {
    // The whole point: a 401 reached the server. Offering an offline launch
    // here would be a dead end for anyone whose refresh token actually died.
    expect(isNetworkFailure(new Error('HTTP 401 invalid_grant'))).toBe(false);
    expect(isNetworkFailure(new Error('Session expired — please log in again'))).toBe(false);
    expect(isNetworkFailure(Object.assign(new Error('nope'), { code: 'ERR_BAD_REQUEST' }))).toBe(
      false,
    );
  });

  it('handles non-errors without throwing', () => {
    expect(isNetworkFailure(undefined)).toBe(false);
    expect(isNetworkFailure(null)).toBe(false);
    expect(isNetworkFailure('ENOTFOUND')).toBe(false);
  });

  it('terminates on a self-referential cause chain', () => {
    // Defensive, but a cycle here would hang the launch rather than fail it.
    const a = new Error('a') as Error & { cause?: unknown };
    const b = new Error('b') as Error & { cause?: unknown };
    a.cause = b;
    b.cause = a;
    expect(isNetworkFailure(a)).toBe(false);
  });
});
