// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import { heldByAnotherProgram } from './hold-file';

/**
 * Make a file one that cannot be read, in the way the system it is on has.
 *
 * Where a mode is enforced, by taking every permission off it. On Windows a
 * mode is not, and a file is out of reach there for a different reason — some
 * other program has it open and lets nobody else in — so that is what is done:
 * see `heldByAnotherProgram`. The launcher is asked the same thing either way,
 * and has to give the same answer: a file that is there and cannot be read is
 * not an empty one.
 *
 * Root reads through any mode. A test that uses this skips itself there.
 *
 * @returns the way to make it readable again
 */
export async function madeUnreadable(file: string): Promise<() => Promise<void>> {
  if (process.platform === 'win32') return heldByAnotherProgram(file);
  const { mode } = await fs.stat(file);
  await fs.chmod(file, 0o000);
  return () => fs.chmod(file, mode & 0o777);
}

/** What a read of such a file is refused with: by its mode, or by whoever holds it. */
export const REFUSED = /EACCES|EBUSY|EPERM/;
