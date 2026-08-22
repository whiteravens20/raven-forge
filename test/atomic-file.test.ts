import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileAtomic, writeJsonAtomic } from '../src/core/util/atomic-file';

/**
 * The atomic write, over a real directory.
 *
 * The case that matters is two writes to one file from *this* process, which is
 * what the launcher actually does: the temporary file used to be named after the
 * process id alone, so both writers opened the same one, wrote into it from
 * offset zero, and renamed the mixture into place. Every reader of these files
 * treats a parse failure as "empty", so the result was not a lost write but a
 * silently emptied file.
 */

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-atomic-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('writeFileAtomic', () => {
  it('leaves the file readable as one of the two documents, never a mixture', async () => {
    const file = path.join(dir, 'installed.lock');
    // Different lengths on purpose: interleaving a short document into a long
    // one leaves trailing bytes of the long one, which is the shape that used to
    // survive as unparseable JSON.
    const long = Array.from({ length: 400 }, (_, i) => ({ id: `mod-${i}`, enabled: true }));
    const short = [{ id: 'only', enabled: false }];

    await Promise.all([writeJsonAtomic(file, long), writeJsonAtomic(file, short)]);

    const parsed = JSON.parse(await fs.readFile(file, 'utf-8')) as unknown[];
    expect([long.length, short.length]).toContain(parsed.length);
  });

  it('survives many concurrent writes to the same file', async () => {
    const file = path.join(dir, 'settings.json');
    await Promise.all(Array.from({ length: 30 }, (_, i) => writeJsonAtomic(file, { round: i })));

    const parsed = JSON.parse(await fs.readFile(file, 'utf-8')) as { round: number };
    expect(parsed.round).toBeGreaterThanOrEqual(0);
    expect(parsed.round).toBeLessThan(30);
  });

  it('leaves no temporary files behind', async () => {
    const file = path.join(dir, 'profiles.json');
    await Promise.all(Array.from({ length: 10 }, (_, i) => writeJsonAtomic(file, { i })));

    const left = (await fs.readdir(dir)).filter((name) => name.endsWith('.tmp'));
    expect(left).toEqual([]);
  });

  it('creates the parent directory', async () => {
    const file = path.join(dir, 'nested', 'deeper', 'state.json');
    await writeJsonAtomic(file, { ok: true });
    expect(JSON.parse(await fs.readFile(file, 'utf-8'))).toEqual({ ok: true });
  });

  it('applies the requested mode, including over a file that already exists', async () => {
    if (process.platform === 'win32') return;
    const file = path.join(dir, 'auth.json');
    await fs.writeFile(file, 'stale', { mode: 0o644 });

    await writeFileAtomic(file, 'fresh', 0o600);

    const stat = await fs.stat(file);
    expect(stat.mode & 0o777).toBe(0o600);
    expect(await fs.readFile(file, 'utf-8')).toBe('fresh');
  });

  it('removes the temporary file when the write cannot be renamed into place', async () => {
    // A directory where the file should go: the rename fails, and the point is
    // that a full disk does not leave a `.tmp` beside every state file.
    const file = path.join(dir, 'blocked');
    await fs.mkdir(file);

    await expect(writeFileAtomic(file, 'x')).rejects.toThrow();
    const left = (await fs.readdir(dir)).filter((name) => name.endsWith('.tmp'));
    expect(left).toEqual([]);
  });
});
