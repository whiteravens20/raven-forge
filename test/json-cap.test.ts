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

  it('stops receiving a body the moment it is over the cap', async () => {
    // The point of the cap is what reaches memory, not what reaches the parser.
    // This used to take in all forty megabytes and then decline to parse them.
    const chunk = new Uint8Array(64 * 1024);
    let sent = 0;
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.length;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });

    await expect(readJsonCapped(new Response(endless), 'manifest', 256 * 1024)).rejects.toThrow(
      /implausibly large/,
    );

    expect(cancelled).toBe(true);
    // A little past the cap at most — a chunk or two that were already on their way.
    expect(sent).toBeLessThan(1024 * 1024);
  });

  it('counts bytes, which is what a size limit is in', async () => {
    // Four hundred characters, eight hundred bytes.
    const res = response(JSON.stringify({ pad: 'ż'.repeat(400) }));
    await expect(readJsonCapped(res, 'manifest', 500)).rejects.toThrow(/implausibly large/);
  });

  it('reads a document that begins with a byte order mark', async () => {
    const res = new Response(Buffer.from('\uFEFF{"ok":true}', 'utf-8'));
    await expect(readJsonCapped(res, 'manifest')).resolves.toEqual({ ok: true });
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
