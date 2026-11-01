// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, expect, it } from 'vitest';
import { isConnectionFailure } from '../src/core/net/connection-failure';

/** What Node's fetch throws: two words, with the reason on `cause`. */
function fetchFailed(code: string): Error {
  return new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) });
}

describe('isConnectionFailure', () => {
  it.each(['EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH'])(
    'knows %s for what it is, under "fetch failed"',
    (code) => {
      expect(isConnectionFailure(fetchFailed(code))).toBe(true);
    },
  );

  it.each([
    'net::ERR_INTERNET_DISCONNECTED',
    'net::ERR_NAME_NOT_RESOLVED',
    'net::ERR_CONNECTION_REFUSED',
    'net::ERR_PROXY_CONNECTION_FAILED',
    'net::ERR_TIMED_OUT',
    'net::ERR_CONTENT_LENGTH_MISMATCH',
  ])('knows %s, from what goes through Chromium', (message) => {
    expect(isConnectionFailure(new Error(message))).toBe(true);
  });

  it('knows a request that timed out', () => {
    expect(isConnectionFailure(new DOMException('timed out', 'TimeoutError'))).toBe(true);
  });

  it.each([
    ['a server that answered 404', new Error('Download failed (404): example.com')],
    ['a file that failed its hash', new Error('sha512 mismatch for probe')],
    ['a certificate problem Chromium names', new Error('net::ERR_CERT_DATE_INVALID')],
    ['not an error at all', 'fetch failed'],
    ['nothing', undefined],
  ])('does not mistake %s for it', (_name, err) => {
    expect(isConnectionFailure(err)).toBe(false);
  });
});
