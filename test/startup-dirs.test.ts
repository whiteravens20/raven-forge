import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The directories a first launch has to end up with.
 *
 * Most of the launcher creates its own parents on the way past, so this looks
 * like belt and braces — except for the two it is actually for. `crash-reports/`
 * is created empty because Settings has a button that opens it, and a button
 * that fails until the day something crashes is worse than a folder saying
 * nothing has. `logs/` is the same bargain for the log viewer.
 *
 * And the whole set has to survive the data root moving to another drive, which
 * is the case where "somebody else will have made it by then" stops being true:
 * the new root is empty by definition.
 */

const { userData } = vi.hoisted(() => ({ userData: { path: '' } }));

vi.mock('electron', () => ({
  app: { getPath: () => userData.path, getVersion: () => '0.0.0-test', isPackaged: false },
}));

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-startup-'));
  // Diagnostics stay in Electron's own directory whatever the data root does,
  // so the two are pointed at different places here on purpose.
  userData.path = path.join(root, 'userData');
  process.env.RAVENFORGE_DATA_DIR = path.join(root, 'data');
});

afterEach(async () => {
  delete process.env.RAVENFORGE_DATA_DIR;
  await fs.rm(root, { recursive: true, force: true });
});

async function ensure(): Promise<void> {
  vi.resetModules();
  const { reloadDataRoot } = await import('../src/core/config/data-root');
  reloadDataRoot();
  const { ensureDataDirectories } = await import('../src/main/init');
  await ensureDataDirectories();
}

const isDir = async (p: string) => (await fs.stat(p)).isDirectory();

describe('ensureDataDirectories', () => {
  it('creates everything a launch expects to already be there', async () => {
    await ensure();
    for (const dir of ['profiles', 'loaders', 'java', 'cache']) {
      expect(await isDir(path.join(root, 'data', dir))).toBe(true);
    }
  });

  it('creates the two diagnostics folders in userData, not under the data root', async () => {
    await ensure();
    expect(await isDir(path.join(root, 'userData', 'logs'))).toBe(true);
    expect(await isDir(path.join(root, 'userData', 'crash-reports'))).toBe(true);
    await expect(fs.access(path.join(root, 'data', 'logs'))).rejects.toThrow();
  });

  it('leaves what is already there alone', async () => {
    // It runs on every start, not only the first one.
    await ensure();
    const marker = path.join(root, 'data', 'profiles', 'keep.txt');
    await fs.writeFile(marker, 'a profile lives here');

    await ensure();
    expect(await fs.readFile(marker, 'utf-8')).toBe('a profile lives here');
  });

  it('makes the whole path, not only the last segment', async () => {
    // The data root itself does not exist yet when it is somewhere the user
    // just chose — a fresh directory on a second drive.
    await ensure();
    expect(await isDir(path.join(root, 'data'))).toBe(true);
  });
});
