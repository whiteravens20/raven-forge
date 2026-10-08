// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { assertSecureContentUrl, isSecureContentUrl } from '../../shared/validators';
import { expectedHash, type HashedEntry } from '../mods/integrity';
import { serializeByKey } from '../util/serialize';
import { flushToDisk } from '../util/atomic-file';

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
   * Refuse a symlink already sitting where the file is about to go, rather than
   * replace it. Nothing is ever written *through* one — the body goes to a
   * temporary file and is renamed into place, and a rename replaces a link
   * instead of following it — but a link at that path is something a person
   * put there, and a pack's config file is not a reason to remove it quietly.
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
   * What the body has to hash to, and what to call the file when it does not.
   *
   * Digested as the bytes are written and compared before the file is given its
   * name. Every caller used to check afterwards, by which time the wrong bytes
   * had already replaced whatever was there — and deleting them then left
   * nothing at all — and the whole file was read back from disk just to be
   * hashed. Hashes that name no algorithm accept the body as it arrives.
   */
  verify?: { hashes: HashedEntry; label: string };
  /**
   * Whoever asked for this file looks at it again — its size, or its hash —
   * every time it is about to be used.
   *
   * A file is sent to the disk before it is given its name, for the reason a
   * state file is: the rename records the name, and a power cut in the seconds
   * after it can leave that name on an empty file. For a mod, a pack or a
   * library nobody published a hash for, nothing would ever notice. The game's
   * own files are another matter — a launch checks each against Mojang's list
   * before it starts, and there are four thousand of them in a first install —
   * so the one caller that fetches those says so here and goes without.
   */
  checkedAgain?: boolean;
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
 * The body is received into `<dest>.part`, sent to the disk, and renamed onto
 * the destination once it is whole and, where a hash was given, correct. Writing straight to the
 * destination meant a download that failed took the file already there with
 * it: a pack whose new `options.txt` answered 503 deleted the player's own. A
 * failure now leaves the destination exactly as it was, and nothing half
 * written beside it.
 */
export async function downloadToFile(
  url: string,
  dest: string,
  options: DownloadOptions = {},
): Promise<void> {
  // Before any request or side effect: a plaintext URL is refused outright, not
  // fetched and then discarded.
  if (options.secure) assertSecureContentUrl(url);
  await fs.mkdir(path.dirname(dest), { recursive: true });

  // One at a time per destination. Two downloads of one file share its
  // temporary name, and each would be hashing what it received while the disk
  // held a mixture of both — which would then be renamed into place as verified.
  return serializeByKey(dest, () => receive(url, dest, options));
}

async function isSymlink(file: string): Promise<boolean> {
  try {
    return (await fs.lstat(file)).isSymbolicLink();
  } catch {
    return false;
  }
}

async function receive(url: string, dest: string, options: DownloadOptions): Promise<void> {
  const { signal, maxBytes, noFollow, onProgress, secure, verify, checkedAgain } = options;

  if (noFollow && (await isSymlink(dest))) {
    throw new Error(`Refusing to replace a symlink: ${dest}`);
  }

  // The name is fixed rather than random so that what a killed launcher left
  // behind is overwritten by the next attempt instead of accumulating.
  const part = `${dest}.part`;

  const controller = new AbortController();
  const abort = () => controller.abort();
  // A signal that fired before this turn came up never fires again.
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });

  let stall = setTimeout(abort, STALL_TIMEOUT_MS);
  const keepAlive = () => {
    clearTimeout(stall);
    stall = setTimeout(abort, STALL_TIMEOUT_MS);
  };

  // Set when the cap is hit, so the shared abort path below does not misreport a
  // deliberate size refusal as a stalled transfer.
  let tooBig = false;

  const expected = verify ? expectedHash(verify.hashes) : null;
  const digest = expected ? crypto.createHash(expected.algorithm) : null;

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
    // numeric flag: the temporary name is the launcher's own, and nothing that
    // belongs there is ever a link. Awaiting each write is its own backpressure
    // — a chunk is on disk before the next is read — so nothing buffers
    // unbounded whatever the link speed.
    const handle = await fs.open(
      part,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | O_NOFOLLOW,
    );
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
        digest?.update(value);
        await handle.write(value);
        onProgress?.(received, declared > 0 ? declared : undefined);
      }
      if (!checkedAgain) await flushToDisk(handle, dest);
    } finally {
      await handle.close();
    }

    if (expected && digest) {
      const actual = digest.digest('hex');
      if (actual !== expected.value) {
        throw new Error(
          `${expected.algorithm} mismatch for ${verify!.label}: ` +
            `expected ${expected.value}, got ${actual}`,
        );
      }
    }

    await fs.rename(part, dest);
  } catch (err) {
    await fs.rm(part, { force: true });
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
