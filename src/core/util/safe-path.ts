import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Resolve `relative` under `baseDir` and refuse if the real destination would
 * fall outside it — including via a symlink planted anywhere along the path.
 *
 * Two checks, because they catch different things. The logical one — that
 * `path.relative` stays inside — refuses a `../` in the name. It cannot see the
 * other case: a component that reads as contained but is a symlink pointing out
 * of the tree, so a writer following it lands wherever the link says. For that
 * the parent directory is created and then resolved with `realpath`, and the
 * resolved parent must still sit under the resolved base. Comparing the two
 * *resolved* paths means a symlink in the prefix they share — a `/tmp` that is
 * really `/private/tmp`, say — cancels out instead of reading as an escape.
 *
 * This secures the path down to the parent; the final component is left to an
 * `O_NOFOLLOW` open (see `applyOverrides`) or `downloadToFile({ noFollow })`, so
 * a symlink sitting exactly where the file goes is refused rather than followed.
 *
 * @returns the absolute destination, its parent created and proven contained
 */
export async function resolveWithin(baseDir: string, relative: string): Promise<string> {
  const dest = path.resolve(baseDir, relative);
  const rel = path.relative(baseDir, dest);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Refusing to write outside the target directory: ${relative}`);
  }

  const parent = path.dirname(dest);
  await fs.mkdir(parent, { recursive: true });
  const [realParent, realBase] = await Promise.all([fs.realpath(parent), fs.realpath(baseDir)]);
  const relReal = path.relative(realBase, realParent);
  if (relReal.startsWith('..') || path.isAbsolute(relReal)) {
    throw new Error(`Refusing to follow a symlink out of the target directory: ${relative}`);
  }

  return dest;
}
