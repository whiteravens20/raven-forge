// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { log } from '../../main/logger';

/**
 * What a place that cannot be flushed answers a flush with.
 *
 * `EINVAL` is Linux's word for it — its null device says so, and so does a file
 * that is not on any disk. `ENOTSUP` and `ENOSYS` are the same from a
 * filesystem that says it outright. `EISDIR` is how Windows' "invalid function"
 * reaches Node, which is what a driver with no flush of its own returns.
 *
 * Nothing else belongs here. A disk that is full or failing has refused the
 * bytes, not the request, and that is still a write that did not happen.
 */
const CANNOT_BE_FLUSHED = new Set(['EINVAL', 'ENOTSUP', 'ENOSYS', 'EISDIR']);

let saidItCannotFlush = false;

/**
 * Send what was written through `handle` to the disk, where the filesystem
 * takes the request at all.
 *
 * Not every one does: a folder kept by a program of its own — an encrypted
 * one, a mounted cloud drive — may have no such thing as a flush. Held to it
 * there, the launcher could save nothing: not a setting, not a profile, not a
 * sign-in. So a filesystem that cannot be asked is written to as files always
 * were, and the log says so, once. What it protects against is a power cut in
 * the seconds after a write, which is a small thing to go without beside not
 * being able to write.
 */
export async function flushToDisk(handle: FileHandle, file: string): Promise<void> {
  try {
    await handle.sync();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (!code || !CANNOT_BE_FLUSHED.has(code)) throw err;
    if (saidItCannotFlush) return;
    saidItCannotFlush = true;
    log.warn(
      `${path.dirname(file)} is on a filesystem that cannot be told to flush (${code}) — ` +
        'files there are written without it',
    );
  }
}

/** What Windows answers a rename with while something has the file being replaced open. */
const HELD_BY_SOMETHING = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** How long a rename Windows refused is waited on before the next try, in turn. */
const RENAME_WAITS_MS = [5, 10, 20, 40, 80, 160, 320, 640, 1280];

const isFolder = (target: string): Promise<boolean> =>
  fs.stat(target).then(
    (found) => found.isDirectory(),
    () => false,
  );

/**
 * Give a finished file its name, in place of whatever has that name now.
 *
 * On Windows this is refused for as long as anything has the file being
 * replaced open: another write that is replacing it at this very moment, an
 * antivirus reading what was written a moment ago. Such a refusal is over in
 * milliseconds, and it used to fail the write — thirty saves of one file at
 * once, which is a test this launcher has always had, lost several of them to
 * `EPERM` the first time it was run on a Windows. So there the rename is asked
 * again, for about two and a half seconds in all, before the write is called
 * failed. The waits are unequal on purpose: writers that collided once would
 * otherwise come back in step and collide again.
 *
 * Everywhere else a rename is not refused for that reason, and what it is
 * refused for does not pass by itself.
 */
export async function renameIntoPlace(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      const wait = RENAME_WAITS_MS[attempt];
      const code = (err as NodeJS.ErrnoException).code;
      if (process.platform !== 'win32' || wait === undefined || !code) throw err;
      if (!HELD_BY_SOMETHING.has(code)) throw err;
      // A folder standing where the file goes is refused with the same word,
      // and is not something that lets go: waiting on it only made the answer
      // two and a half seconds late.
      if (await isFolder(to)) throw err;
      await new Promise((resolve) => setTimeout(resolve, wait * (0.5 + Math.random())));
    }
  }
}

/**
 * Read and write for the account that runs the launcher, nothing for any other.
 *
 * The launcher makes its own folders closed to other accounts, but a folder the
 * data was moved into that was already there keeps the permissions it had, and
 * what the files hold can be a proxy's password or an address with a token in
 * it. A disk that keeps no permissions — FAT32, exFAT, NTFS through ntfs-3g,
 * tried on Linux — takes the change without a word and goes on keeping every
 * file as its mount options say.
 */
export const OWNER_ONLY = 0o600;

/**
 * Close a file that an older build left open to other accounts.
 *
 * The files the launcher writes now are given {@link OWNER_ONLY} as they are
 * written. One that has not been written since it was made the old way would
 * stay readable by others for as long as nothing changed it, so it is closed
 * when it is read. Nothing is decided by whether that works: what fails is
 * logged and left for the next write. Windows keeps its permissions some other
 * way, and is left alone.
 */
export async function keepToOwner(file: string): Promise<void> {
  if (process.platform === 'win32') return;
  try {
    if (((await fs.stat(file)).mode & 0o077) === 0) return;
    await fs.chmod(file, OWNER_ONLY);
  } catch (err) {
    log.warn(`Could not close ${file} to other accounts:`, err);
  }
}

/**
 * Write a file so that a crash cannot leave half of one behind.
 *
 * Every reader of the launcher's own state files treats a parse failure as
 * "empty" — a truncated `profiles.json` reads as *no profiles*, a truncated
 * `installed.lock` as *nothing installed*. So a write interrupted by a crash, a
 * full disk or a pulled power cable does not corrupt a file in some obvious
 * way; it silently loses everything the file held.
 *
 * Writing to a temporary file in the same directory and then renaming makes the
 * replacement atomic — `rename(2)` within a filesystem either happened or did
 * not — so a reader sees the old contents or the new ones and never a fragment
 * of either. `options-file.ts` has always done this for the player's
 * `options.txt`; the launcher's own files deserve the same care.
 *
 * The rename only orders names. A filesystem may write the new name down
 * before the bytes it stands for, and a power cut between the two leaves that
 * name on an empty file — which is the whole of what this is meant to rule out.
 * So the bytes are sent to the disk before the file is given its name. If the
 * disk will not take them, the write has failed, and the file that was there
 * stays; a filesystem that cannot be asked at all is another matter — see
 * {@link flushToDisk}.
 *
 * The temporary file is deleted on failure, so a full disk does not leave a
 * `.tmp` beside every state file.
 */
export async function writeFileAtomic(
  file: string,
  contents: string,
  mode?: number,
): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });

  // Beside the target, never in the system temp directory: `rename` is only
  // atomic within one filesystem, and across two it silently becomes copy-then-
  // delete, which is the very thing this exists to avoid.
  //
  // The name was `${file}.${process.pid}.tmp`, which is unique between processes
  // and not within one — and within one is where the launcher's overlapping
  // writes actually are. Two of them opened the same temporary file, both wrote
  // from offset zero, and the interleaved result was renamed into place: a JSON
  // document made of two documents, which every reader here treats as an empty
  // file. Callers should still serialize a read-modify-write; this only makes
  // sure that when they do not, the failure is a lost write and not a wiped one.
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    const handle = await fs.open(tmp, 'w', mode);
    try {
      await handle.writeFile(contents, 'utf-8');
      await flushToDisk(handle, file);
    } finally {
      await handle.close();
    }
    // The mode is applied only when the file is created, and a leftover tmp
    // from a previous run would keep its old permissions without this.
    if (mode !== undefined) await fs.chmod(tmp, mode);
    await renameIntoPlace(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

/** The same, for anything stored as pretty-printed JSON. */
export async function writeJsonAtomic(file: string, value: unknown, mode?: number): Promise<void> {
  await writeFileAtomic(file, JSON.stringify(value, null, 2), mode);
}
