import fs from 'node:fs/promises';
import path from 'node:path';
import { constants as fsConstants } from 'node:fs';
import { assertSecureContentUrl, isSecureContentUrl } from '../../shared/validators';

/** No data for this long means the transfer is dead, not merely slow. */
const STALL_TIMEOUT_MS = 45_000;

/**
 * `O_NOFOLLOW` where the platform has it. Windows does not, and there a symlink
 * needs a privilege to create in the first place; falling back to 0 leaves the
 * flag off rather than corrupting the bit set, and the callers that ask for it
 * pair it with a realpath check on the parent directory regardless.
 */
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;

export interface DownloadOptions {
  /** Cancels the download; a user calling off a sync is not an error. */
  signal?: AbortSignal;
  /**
   * Abort and delete the partial file once the body passes this many bytes.
   * For URLs the launcher does not control — a pasted pack address — so that a
   * hostile or mistaken multi-gigabyte response cannot fill the disk before the
   * archive is even read.
   */
  maxBytes?: number;
  /**
   * Open the destination with `O_NOFOLLOW`, so a symlink already sitting where
   * the file is about to be written is refused rather than followed out of the
   * directory tree.
   */
  noFollow?: boolean;
  /**
   * Require the transport to stay secure — https, or http only to loopback. The
   * initial URL is refused before a byte is sent, and the final URL a redirect
   * chain lands on is refused before the body is written, so an https link that
   * 302s down to http cannot slip past. For a file this process will load as
   * code (a mod jar, a config a manifest ships), where an entry with no hash is
   * otherwise accepted on trust and a plaintext hop is a place to swap it.
   */
  secure?: boolean;
  /**
   * Called as the body arrives, with what has been written so far and what the
   * server declared — `undefined` when it declared nothing. Here rather than in
   * a caller's own copy of this loop: a progress bar was the only reason the JRE
   * download had a second implementation of all of this, and that copy had no
   * timeout at all.
   */
  onProgress?: (received: number, total: number | undefined) => void;
}

/**
 * Stream a download to disk, failing on a stall rather than on total duration.
 *
 * The obvious `AbortSignal.timeout(60_000)` is wrong here and was: that signal
 * governs the *body stream* as well as the request, so a 90 MB resource pack on
 * a normal connection aborts halfway every time. What actually indicates a dead
 * transfer is silence, so the deadline resets on every chunk.
 *
 * A failed download must not leave its partial file behind. It would sit in the
 * profile looking installed while being absent from every index — which is
 * exactly the state an earlier version of this produced.
 */
export async function downloadToFile(
  url: string,
  dest: string,
  options: DownloadOptions = {},
): Promise<void> {
  const { signal, maxBytes, noFollow, onProgress, secure } = options;
  // Before any request or side effect: a plaintext URL is refused outright, not
  // fetched and then discarded.
  if (secure) assertSecureContentUrl(url);
  await fs.mkdir(path.dirname(dest), { recursive: true });

  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });

  let stall = setTimeout(abort, STALL_TIMEOUT_MS);
  const keepAlive = () => {
    clearTimeout(stall);
    stall = setTimeout(abort, STALL_TIMEOUT_MS);
  };

  // Set when the cap is hit, so the shared abort path below does not misreport a
  // deliberate size refusal as a stalled transfer.
  let tooBig = false;

  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal });
    if (!res.ok || !res.body) {
      throw new Error(`Download failed (${res.status}): ${new URL(url).host}`);
    }

    // The URL the redirect chain actually landed on. Checked before the body is
    // read, so an https address that redirected down to http is refused rather
    // than written — the initial-URL check above cannot see where a 302 leads.
    // The controller has not been aborted here, so this throws straight through
    // the catch without being mistaken for a stall.
    if (secure && !isSecureContentUrl(res.url)) {
      throw new Error(`Refusing an insecure redirect to ${new URL(res.url).host}`);
    }

    // A server that declares a length over the cap is refused before the body is
    // read at all; the running count below still catches one that lies.
    const declared = Number(res.headers.get('content-length')) || 0;
    onProgress?.(0, declared > 0 ? declared : undefined);
    if (maxBytes && declared > maxBytes) {
      tooBig = true;
      throw new Error(
        `Refusing ${new URL(url).host}: it declares ${declared} bytes, over the limit`,
      );
    }

    // A FileHandle rather than a write stream so `O_NOFOLLOW` can go in as a
    // numeric flag when asked; the ordinary case opens with a plain `'w'`.
    // Awaiting each write is its own backpressure — a chunk is on disk before
    // the next is read — so nothing buffers unbounded whatever the link speed.
    const flags = noFollow
      ? fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | O_NOFOLLOW
      : 'w';
    const handle = await fs.open(dest, flags);
    const reader = res.body.getReader();
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        keepAlive();
        received += value.length;
        if (maxBytes && received > maxBytes) {
          tooBig = true;
          controller.abort();
          throw new Error(`Download exceeded the ${maxBytes}-byte limit: ${new URL(url).host}`);
        }
        await handle.write(value);
        onProgress?.(received, declared > 0 ? declared : undefined);
      }
    } finally {
      await handle.close();
    }
  } catch (err) {
    await fs.rm(dest, { force: true });
    // A cancelled download and a dead one abort identically; only the caller's
    // signal tells them apart, and only one of them is a failure worth naming.
    // A size refusal aborted the fetch itself, so it must not be read as either.
    if (!tooBig && controller.signal.aborted && !signal?.aborted) {
      throw new Error(
        `Download stalled for ${STALL_TIMEOUT_MS / 1000}s and was cancelled: ${url}`,
        {
          cause: err,
        },
      );
    }
    throw err;
  } finally {
    clearTimeout(stall);
    signal?.removeEventListener('abort', abort);
  }
}
