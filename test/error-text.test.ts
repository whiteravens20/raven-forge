// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect } from 'vitest';
import { errorText, withCauses } from '../src/core/util/error-text';

/**
 * Saying why a request failed.
 *
 * Every one of them arrives as `TypeError: fetch failed`, with the reason one
 * level down. Read by its message alone, a refused connection, a host that does
 * not exist and an expired certificate are the same two words.
 */

const refused = () =>
  Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1080'), { code: 'ECONNREFUSED' });

describe('errorText', () => {
  it('says what was underneath a failed request', () => {
    const err = new TypeError('fetch failed', { cause: refused() });
    expect(errorText(err)).toBe('fetch failed: connect ECONNREFUSED 127.0.0.1:1080');
  });

  it('gives the code of a cause that has no message', () => {
    // What a connection tried over several addresses fails with.
    const tried = Object.assign(new AggregateError([refused()], ''), { code: 'ECONNREFUSED' });
    expect(errorText(new TypeError('fetch failed', { cause: tried }))).toBe(
      'fetch failed: ECONNREFUSED',
    );
  });

  it('adds a code the message does not already mention', () => {
    const err = Object.assign(new Error('getaddrinfo failed'), { code: 'ENOTFOUND' });
    expect(errorText(err)).toBe('getaddrinfo failed (ENOTFOUND)');
  });

  it('does not repeat a cause its wrapper already quotes', () => {
    const cause = new Error('sha1 mismatch');
    const err = new Error(`Failed to download a.jar after 3 attempts: ${cause}`, { cause });
    expect(errorText(err)).toBe('Failed to download a.jar after 3 attempts: Error: sha1 mismatch');
  });

  it('reads nothing but the name, the message and the code', () => {
    // The SOCKS client's errors carry the options they were made with.
    const cause = Object.assign(new Error('Socket closed'), {
      options: { proxy: { password: 'hunter2' } },
    });
    expect(errorText(new Error('fetch failed', { cause }))).not.toContain('hunter2');
  });

  it('stops at a cause that leads back to where it came from', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    a.cause = b;
    expect(errorText(a)).toBe('a: b');
  });

  it('takes something thrown that is not an error as it is', () => {
    expect(errorText('just a string')).toBe('just a string');
    expect(errorText(new Error('wrapped', { cause: 'a string cause' }))).toBe(
      'wrapped: a string cause',
    );
  });
});

describe('withCauses', () => {
  it('follows an error with its cause, which a stack leaves out', () => {
    const err = new TypeError('fetch failed', { cause: refused() });
    const [label, written] = withCauses(['Failed to fetch the news feed:', err]) as string[];

    expect(label).toBe('Failed to fetch the news feed:');
    expect(written).toContain('TypeError: fetch failed');
    expect(written).toContain('caused by: connect ECONNREFUSED 127.0.0.1:1080');
  });

  it('leaves alone everything that has no cause to add', () => {
    const plain = new Error('plain');
    const args = ['text', 42, plain, { some: 'object' }];
    expect(withCauses(args)).toEqual(args);
    expect(withCauses(args)[2]).toBe(plain);
  });
});
