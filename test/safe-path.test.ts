import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveWithin } from '../src/core/util/safe-path';

/**
 * The rule that keeps an archive from writing outside the directory it is
 * being unpacked into.
 *
 * Every name here arrives from somewhere the launcher does not control — a
 * `.mrpack`'s overrides, a manifest's config file list — and each one is joined
 * onto a profile directory. Two different escapes have to be refused: a `../`
 * in the name, which is visible in the string, and a symlink planted in the
 * path, which is not. Only the second one survives being looked at.
 */

let base: string;
let outside: string;

beforeEach(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-within-'));
  base = path.join(root, 'base');
  outside = path.join(root, 'outside');
  await fs.mkdir(base, { recursive: true });
  await fs.mkdir(outside, { recursive: true });
});

afterEach(async () => {
  await fs.rm(path.dirname(base), { recursive: true, force: true });
});

describe('resolveWithin', () => {
  it('resolves an ordinary relative name under the base', async () => {
    const dest = await resolveWithin(base, 'config/mod.toml');
    expect(dest).toBe(path.join(base, 'config', 'mod.toml'));
  });

  it('creates the parent directory so the caller can just write', async () => {
    await resolveWithin(base, 'deeply/nested/file.txt');
    await expect(fs.stat(path.join(base, 'deeply', 'nested'))).resolves.toBeTruthy();
  });

  it('refuses a name that climbs out with ..', async () => {
    await expect(resolveWithin(base, '../outside/evil.txt')).rejects.toThrow(/outside/i);
  });

  it('refuses a name that climbs out from deeper in', async () => {
    await expect(resolveWithin(base, 'a/b/../../../outside/evil.txt')).rejects.toThrow(/outside/i);
  });

  it('refuses an absolute name', async () => {
    await expect(resolveWithin(base, '/etc/passwd')).rejects.toThrow(/outside/i);
  });

  it('refuses the base itself — there is no file to write there', async () => {
    await expect(resolveWithin(base, '.')).rejects.toThrow(/outside/i);
  });

  it('refuses a directory that reads as contained but is a symlink out', async () => {
    // Nothing in the string gives this away: `escape/evil.txt` is as contained
    // as any other name until the link is resolved.
    await fs.symlink(outside, path.join(base, 'escape'), 'dir');
    await expect(resolveWithin(base, 'escape/evil.txt')).rejects.toThrow(/symlink/i);
  });

  it('refuses a symlink planted part-way down the path', async () => {
    await fs.mkdir(path.join(base, 'config'), { recursive: true });
    await fs.symlink(outside, path.join(base, 'config', 'sub'), 'dir');
    await expect(resolveWithin(base, 'config/sub/evil.txt')).rejects.toThrow(/symlink/i);
  });

  it('allows a base that is itself reached through a symlink', async () => {
    // The macOS case: /tmp is really /private/tmp. Comparing resolved paths on
    // both sides means the shared prefix cancels instead of reading as escape.
    const linkedBase = path.join(path.dirname(base), 'linked-base');
    await fs.symlink(base, linkedBase, 'dir');
    const dest = await resolveWithin(linkedBase, 'ok.txt');
    expect(dest).toBe(path.join(linkedBase, 'ok.txt'));
  });

  it('leaves the final component to the caller to open safely', async () => {
    // A symlink sitting exactly where the file goes is *not* this function's
    // job — the parent is what it proves. Documented so the O_NOFOLLOW open on
    // the other side is not quietly dropped as redundant.
    await fs.symlink(path.join(outside, 'target.txt'), path.join(base, 'file.txt'));
    await expect(resolveWithin(base, 'file.txt')).resolves.toBe(path.join(base, 'file.txt'));
  });
});
