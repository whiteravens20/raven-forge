// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { assertSecureContentUrl } from '../../shared/validators';

/**
 * Reading JSON from somewhere that is not obliged to be reasonable.
 *
 * `res.json()` buffers whatever the other end chooses to send. Every document
 * the launcher fetches — a manifest, the pack catalogue, a news feed — is a
 * short list of references, so a hostile or simply broken host is the only way
 * one of them arrives large enough to matter, and by then it is already in the
 * main process's heap. `mrpack.ts` has capped its index since it was written;
 * this is the same idea for the routes that had not.
 */

/**
 * Refuse an answer that came from somewhere a request would not have been sent.
 *
 * The address asked for is checked before the request, and `fetch` follows a
 * redirect by itself — so the address that finally answered had not been
 * checked at all. A manifest asked for over https and served, one redirect
 * later, over plain http was read as if nothing had happened, on the one hop
 * where it could be swapped. `downloadToFile` has always looked at where it
 * ended up; this is the same look for the documents.
 */
export function assertSecureAnswer(res: Response): void {
  // Empty on a response built by hand rather than received; a real one has it.
  if (res.url) assertSecureContentUrl(res.url);
}

/** Short lists of references. None of these documents is a large file. */
const MAX_REMOTE_JSON_BYTES = 8 * 1024 * 1024;

/**
 * Parse a response as JSON, having read no more of it than `limit` bytes.
 *
 * Counted as the body arrives, and the transfer dropped the moment it is over.
 * It used to read the whole body first and measure it afterwards, which refused
 * to *parse* forty megabytes and had by then received every one of them — the
 * cap protected the parser and not the memory it was written to protect.
 */
export async function readJsonCapped(
  res: Response,
  label: string,
  limit = MAX_REMOTE_JSON_BYTES,
): Promise<unknown> {
  const tooLarge = () => new Error(`${label} is implausibly large — refusing to parse it`);

  const declared = Number(res.headers.get('content-length'));
  if (declared > limit) {
    await res.body?.cancel();
    throw tooLarge();
  }
  if (!res.body) return JSON.parse(await res.text());

  // `Content-Length` is absent on a chunked response — which is exactly how a
  // host would avoid declaring its size — so the bytes themselves are counted.
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    if (received > limit) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }

  return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
}
