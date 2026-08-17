import fs from 'node:fs/promises';
import path from 'node:path';
import { constants as fsConstants } from 'node:fs';

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
  const { signal, maxBytes, noFollow } = options;
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

    // A server that declares a length over the cap is refused before the body is
    // read at all; the running count below still catches one that lies.
    const declared = Number(res.headers.get('content-length')) || 0;
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
