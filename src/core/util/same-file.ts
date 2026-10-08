// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';

/**
 * Whether two paths are one file on disk, whatever they are spelled like.
 *
 * Asked before copying a file somewhere: a copy onto itself empties it, and the
 * strings are no guide — a link, a different case on a filesystem that ignores
 * case, or a path with `..` in it all spell one file two ways. A path that is
 * not there is no file, so it is the same as nothing.
 */
export async function isSameFile(a: string, b: string): Promise<boolean> {
  try {
    const [first, second] = await Promise.all([
      fs.stat(a, { bigint: true }),
      fs.stat(b, { bigint: true }),
    ]);
    return first.dev === second.dev && first.ino === second.ino;
  } catch {
    return false;
  }
}
