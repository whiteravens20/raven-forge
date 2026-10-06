// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect } from 'vitest';
import { assertSecureAnswer, readJsonCapped } from '../src/core/net/json';

/**
 * Reading JSON from a host that is not obliged to be reasonable.
 *
 * `res.json()` buffers whatever the other end chooses to send, and by the time
 * it is too much it is already in the main process's heap. Every document the
 * launcher fetches this way — a manifest, the pack catalogue, a news feed — is
 * a short list of references, so a document large enough to matter is either a
 * broken host or a hostile one, and both get the same answer.
 */

const response = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, { headers });

describe('readJsonCapped', () => {
  it('parses a document of a sane size', async () => {
    const res = response(JSON.stringify({ ok: true, items: [1, 2, 3] }));
    await expect(readJsonCapped(res, 'catalogue')).resolves.toEqual({ ok: true, items: [1, 2, 3] });
  });

  it('refuses before reading when the size is declared and too large', async () => {
    const res = response('{}', { 'content-length': String(9 * 1024 * 1024) });
    await expect(readJsonCapped(res, 'catalogue')).rejects.toThrow(/implausibly large/);
  });

  it('refuses a body that overruns a cap it never declared', async () => {
    // `Content-Length` is absent on a chunked response, which is exactly how a
    // host would avoid declaring a size. The check after reading is the one
    // that catches it.
    const res = response(JSON.stringify({ pad: 'x'.repeat(500) }));
    await expect(readJsonCapped(res, 'manifest', 100)).rejects.toThrow(/implausibly large/);
  });

  it('names the document it refused, so the log says which host misbehaved', async () => {
    const res = response('x'.repeat(200));
    await expect(readJsonCapped(res, 'the news feed', 100)).rejects.toThrow(/the news feed/);
  });

  it('accepts a document exactly at the limit', async () => {
    const body = JSON.stringify({ a: 1 });
    await expect(readJsonCapped(response(body), 'manifest', body.length)).resolves.toEqual({
      a: 1,
    });
  });

  it('does not treat a missing content-length as a declared zero', async () => {
    const res = response(JSON.stringify({ ok: true }));
    expect(res.headers.get('content-length')).toBeNull();
    await expect(readJsonCapped(res, 'manifest')).resolves.toEqual({ ok: true });
  });

  it('reports malformed JSON as malformed rather than as an empty document', async () => {
    // Everything downstream validates with a schema, and a silent `{}` would
    // read as a manifest with no mods in it — which is a pack that uninstalls
    // itself.
    await expect(readJsonCapped(response('{ not json'), 'manifest')).rejects.toThrow(SyntaxError);
  });
});

/**
 * The address that answered, as against the one that was asked.
 *
 * `fetch` follows a redirect on its own, so an https manifest address that
 * redirects to plain http hands back a document nothing had checked the
 * transport of.
 */
describe('assertSecureAnswer', () => {
  const answeredFrom = (url: string) => ({ url }) as Response;

  it('takes an answer that came over https, redirected or not', () => {
    expect(() =>
      assertSecureAnswer(answeredFrom('https://cdn.example.net/manifest.json')),
    ).not.toThrow();
  });

  it('takes one from this machine, where a pack is tried out', () => {
    expect(() =>
      assertSecureAnswer(answeredFrom('http://127.0.0.1:8080/manifest.json')),
    ).not.toThrow();
  });

  it('refuses one that ended up on plain http', () => {
    expect(() => assertSecureAnswer(answeredFrom('http://cdn.example.net/manifest.json'))).toThrow(
      /must be https/,
    );
  });

  it('says nothing about a response that was never received', () => {
    expect(() => assertSecureAnswer(new Response('{}'))).not.toThrow();
  });
});
