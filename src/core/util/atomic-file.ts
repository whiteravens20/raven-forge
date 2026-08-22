import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

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
    await fs.writeFile(tmp, contents, mode === undefined ? 'utf-8' : { encoding: 'utf-8', mode });
    // `writeFile` applies `mode` only when it creates the file, and a leftover
    // tmp from a previous run would keep its old permissions without this.
    if (mode !== undefined) await fs.chmod(tmp, mode);
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

/** The same, for anything stored as pretty-printed JSON. */
export async function writeJsonAtomic(file: string, value: unknown, mode?: number): Promise<void> {
  await writeFileAtomic(file, JSON.stringify(value, null, 2), mode);
}
