import fs from 'node:fs/promises';
import path from 'node:path';
import { createWriteStream } from 'node:fs';

/** No data for this long means the transfer is dead, not merely slow. */
const STALL_TIMEOUT_MS = 45_000;

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
 *
 * @param signal cancels the download; a user calling off a sync is not an error
 */
export async function downloadToFile(
  url: string,
  dest: string,
  signal?: AbortSignal,
): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });

  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });

  let stall = setTimeout(abort, STALL_TIMEOUT_MS);
  const keepAlive = () => {
    clearTimeout(stall);
    stall = setTimeout(abort, STALL_TIMEOUT_MS);
  };

  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal });
    if (!res.ok || !res.body) {
      throw new Error(`Download failed (${res.status}): ${new URL(url).host}`);
    }

    const writable = createWriteStream(dest);
    const reader = res.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        keepAlive();
        if (!writable.write(value)) {
          await new Promise<void>((r) => writable.once('drain', r));
        }
      }
      writable.end();
      await new Promise<void>((resolve, reject) => {
        writable.on('finish', resolve);
        writable.on('error', reject);
      });
    } catch (err) {
      writable.destroy();
      throw err;
    }
  } catch (err) {
    await fs.rm(dest, { force: true });
    // A cancelled download and a dead one abort identically; only the caller's
    // signal tells them apart, and only one of them is a failure worth naming.
    if (controller.signal.aborted && !signal?.aborted) {
      throw new Error(`Download stalled for ${STALL_TIMEOUT_MS / 1000}s and was cancelled: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(stall);
    signal?.removeEventListener('abort', abort);
  }
}
