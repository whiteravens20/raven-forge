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

/** Short lists of references. None of these documents is a large file. */
const MAX_REMOTE_JSON_BYTES = 8 * 1024 * 1024;

export async function readJsonCapped(
  res: Response,
  label: string,
  limit = MAX_REMOTE_JSON_BYTES,
): Promise<unknown> {
  const declared = Number(res.headers.get('content-length'));
  if (declared > limit) throw new Error(`${label} is implausibly large — refusing to parse it`);

  const text = await res.text();
  // Checked again after reading, because `Content-Length` is absent on a chunked
  // response — which is exactly how a host would avoid declaring its size.
  if (text.length > limit) throw new Error(`${label} is implausibly large — refusing to parse it`);

  return JSON.parse(text);
}
