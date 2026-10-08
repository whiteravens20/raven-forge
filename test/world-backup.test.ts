// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Profile } from '../src/shared/ipc-types';

/**
 * World backups, over a real directory tree.
 *
 * Worlds are the one thing in a profile that exists nowhere else, so the cases
 * here are the ones where being wrong costs somebody theirs: a restore that
 * deletes before it has copied, an automatic prune that eats a backup somebody
 * took by hand, and a backup id from the renderer that is really a path.
 */

let root: string;
let gameDir: string;

const profile: Profile = {
  id: 'p1',
  name: 'Survival',
  minecraftVersion: '1.21.4',
  modLoader: 'fabric',
  allocatedRamMb: 4096,
  createdAt: '2026-08-18T00:00:00.000Z',
  updatedAt: '2026-08-18T00:00:00.000Z',
};

vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));
vi.mock('../src/core/config/paths', () => ({
  paths: {
    profileBackupsDir: () => path.join(root, 'backups'),
    profileGameDir: () => gameDir,
  },
}));
vi.mock('../src/core/profiles/profile-manager', () => ({
  getProfile: async () => profile,
  directorySize: async (dir: string): Promise<number> => {
    let total = 0;
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      total += entry.isDirectory() ? await total0(full) : (await fs.stat(full)).size;
    }
    async function total0(d: string): Promise<number> {
      let n = 0;
      for (const e of await fs.readdir(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        n += e.isDirectory() ? await total0(f) : (await fs.stat(f)).size;
      }
      return n;
    }
    return total;
  },
}));

const { backupWorlds, listBackups, listWorlds, restoreBackup, deleteBackup } =
  await import('../src/core/profiles/world-backup');

const savesDir = () => path.join(gameDir, 'saves');

async function world(name: string, contents: string): Promise<void> {
  await fs.mkdir(path.join(savesDir(), name), { recursive: true });
  await fs.writeFile(path.join(savesDir(), name, 'level.dat'), contents);
}

/** A backup directory written by hand, so ages can be arranged without waiting. */
async function existingBackup(id: string, reason: string): Promise<void> {
  const dir = path.join(root, 'backups', id, 'saves', 'Old');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'level.dat'), 'old');
  await fs.writeFile(
    path.join(root, 'backups', id, 'backup.json'),
    JSON.stringify({ createdAt: `${id.slice(0, 10)}T00:00:00.000Z`, reason, worlds: ['Old'] }),
  );
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'world-backup-'));
  gameDir = path.join(root, '.minecraft');
  await fs.mkdir(gameDir, { recursive: true });
});

afterEach(async () => {
  // Before the cleanup, not left to each test's last line: an assertion that
  // fails skips that line, and a spy on `fs.rm` then outlives its test.
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

describe('backupWorlds', () => {
  it('copies every world and records what it took', async () => {
    await world('Home', 'home data');
    await world('Nether Base', 'nether data');

    const backup = await backupWorlds('p1', 'manual');

    expect(backup.worlds.sort()).toEqual(['Home', 'Nether Base']);
    expect(backup.reason).toBe('manual');
    expect(backup.bytes).toBeGreaterThan(0);
    const copied = path.join(root, 'backups', backup.id, 'saves', 'Home', 'level.dat');
    expect(await fs.readFile(copied, 'utf-8')).toBe('home data');
  });

  it('refuses instead of producing a backup that restores nothing', async () => {
    await fs.mkdir(savesDir(), { recursive: true });
    await expect(backupWorlds('p1')).rejects.toThrow(/no worlds to back up/);
    expect(await listBackups('p1')).toEqual([]);
  });

  it('keeps the newest automatic copies and never a manual one', async () => {
    await world('Home', 'data');
    await existingBackup('2026-01-01T00-00-01-000', 'manual');
    for (let i = 2; i <= 7; i++) {
      await existingBackup(`2026-01-01T00-00-0${i}-000`, 'version-change');
    }

    // The new one is automatic, so pruning runs and counts it among the keepers.
    const fresh = await backupWorlds('p1', 'version-change');

    const left = await listBackups('p1');
    const automatic = left.filter((b) => b.reason !== 'manual').map((b) => b.id);
    expect(automatic).toHaveLength(5);
    expect(automatic).toContain(fresh.id);
    // The two oldest automatic ones went; the manual one, older than all of
    // them, stayed.
    expect(automatic).not.toContain('2026-01-01T00-00-02-000');
    expect(automatic).not.toContain('2026-01-01T00-00-03-000');
    expect(left.map((b) => b.id)).toContain('2026-01-01T00-00-01-000');
  });

  it('leaves nothing listable behind when the copy fails', async () => {
    await world('Home', 'data');
    // A file where the copy wants to put a directory.
    const spy = vi.spyOn(fs, 'cp').mockRejectedValueOnce(new Error('disk full'));

    await expect(backupWorlds('p1')).rejects.toThrow('disk full');
    expect(await listBackups('p1')).toEqual([]);
    spy.mockRestore();
  });
});

describe('listBackups', () => {
  it('is newest first and ignores anything it cannot identify', async () => {
    await existingBackup('2026-01-01T00-00-01-000', 'manual');
    await existingBackup('2026-03-01T00-00-01-000', 'version-change');
    // A crash between mkdir and the record; and a directory that is not one.
    await fs.mkdir(path.join(root, 'backups', '2026-05-01T00-00-01-000'), { recursive: true });
    await fs.mkdir(path.join(root, 'backups', 'notes'), { recursive: true });

    expect((await listBackups('p1')).map((b) => b.id)).toEqual([
      '2026-03-01T00-00-01-000',
      '2026-01-01T00-00-01-000',
    ]);
  });
  it('reads a copy’s size from its record instead of measuring the copy again', async () => {
    // A copy does not change, and measuring one is a `stat` of every region
    // file in it — which used to happen for every copy at every look.
    await world('Home', 'home data');
    const taken = await backupWorlds('p1', 'manual');
    expect(taken.bytes).toBe('home data'.length);

    // Whatever the folder holds now, the record is what is quoted.
    await fs.writeFile(
      path.join(root, 'backups', taken.id, 'saves', 'Home', 'extra'),
      'x'.repeat(50),
    );
    expect((await listBackups('p1'))[0].bytes).toBe('home data'.length);
  });

  it('measures a copy made before sizes were recorded, once, and writes it down', async () => {
    const id = '2026-01-01T00-00-01-000';
    await existingBackup(id, 'manual');

    expect((await listBackups('p1'))[0].bytes).toBe('old'.length);

    const record = JSON.parse(
      await fs.readFile(path.join(root, 'backups', id, 'backup.json'), 'utf-8'),
    ) as { bytes?: number; reason: string };
    expect(record).toMatchObject({ bytes: 3, reason: 'manual' });
  });
});

describe('restoreBackup', () => {
  it('copies the current worlds aside before replacing them', async () => {
    await world('Home', 'the one to keep');
    const backup = await backupWorlds('p1', 'manual');

    await world('Home', 'changed since');
    await world('Later', 'made afterwards');

    const safety = await restoreBackup('p1', backup.id);

    // What was there is recoverable…
    expect(safety).not.toBeNull();
    expect(safety?.reason).toBe('before-restore');
    expect(safety?.worlds.sort()).toEqual(['Home', 'Later']);
    // …and `saves/` is exactly what the backup held, not a merge of the two.
    expect(await listWorlds('p1')).toEqual(['Home']);
    expect(await fs.readFile(path.join(savesDir(), 'Home', 'level.dat'), 'utf-8')).toBe(
      'the one to keep',
    );
  });

  it('takes no safety copy when there is nothing to lose', async () => {
    await world('Home', 'data');
    const backup = await backupWorlds('p1', 'manual');
    await fs.rm(savesDir(), { recursive: true, force: true });

    expect(await restoreBackup('p1', backup.id)).toBeNull();
    expect(await listWorlds('p1')).toEqual(['Home']);
  });

  it('refuses a backup with nothing in it rather than emptying saves/', async () => {
    await world('Home', 'data');
    await fs.mkdir(path.join(root, 'backups', '2026-01-01T00-00-09-000'), { recursive: true });

    await expect(restoreBackup('p1', '2026-01-01T00-00-09-000')).rejects.toThrow(/holds no worlds/);
    expect(await listWorlds('p1')).toEqual(['Home']);
  });

  it('restores the oldest automatic backup instead of pruning it first', async () => {
    // Five automatic copies is a full set, so the safety copy a restore takes
    // is a sixth and something has to go. It used to be the oldest — the one
    // being restored — and it went before `saves/` was emptied: the restore
    // then had nothing to copy back, and both were gone.
    await world('Home', 'what is there now');
    for (let i = 1; i <= 5; i++) {
      await existingBackup(`2026-01-01T00-00-0${i}-000`, 'version-change');
    }

    const safety = await restoreBackup('p1', '2026-01-01T00-00-01-000');

    expect(await listWorlds('p1')).toEqual(['Old']);
    expect(await fs.readFile(path.join(savesDir(), 'Old', 'level.dat'), 'utf-8')).toBe('old');
    const left = (await listBackups('p1')).map((b) => b.id);
    expect(left).toContain('2026-01-01T00-00-01-000');
    expect(left).toContain(safety?.id);
    const kept = path.join(root, 'backups', safety!.id, 'saves', 'Home', 'level.dat');
    expect(await fs.readFile(kept, 'utf-8')).toBe('what is there now');
  });

  it('still clears out automatic copies that are past keeping', async () => {
    // Protecting the two a restore depends on must not turn every restore into
    // one more full copy of every world, kept for good.
    await world('Home', 'data');
    for (let i = 1; i <= 6; i++) {
      await existingBackup(`2026-01-01T00-00-0${i}-000`, 'version-change');
    }

    const safety = await restoreBackup('p1', '2026-01-01T00-00-05-000');

    expect((await listBackups('p1')).map((b) => b.id)).toEqual([
      safety?.id,
      '2026-01-01T00-00-06-000',
      '2026-01-01T00-00-05-000',
      '2026-01-01T00-00-04-000',
      '2026-01-01T00-00-03-000',
    ]);
  });

  it('keeps the backup and the safety copy when the copy back fails', async () => {
    await world('Home', 'what is there now');
    for (let i = 1; i <= 5; i++) {
      await existingBackup(`2026-01-01T00-00-0${i}-000`, 'version-change');
    }
    // The first copy is the safety one and has to work; the second is the
    // restore itself.
    const copy = fs.cp.bind(fs);
    vi.spyOn(fs, 'cp').mockImplementationOnce(copy).mockRejectedValueOnce(new Error('disk full'));

    await expect(restoreBackup('p1', '2026-01-01T00-00-01-000')).rejects.toThrow('disk full');

    // Nothing was pruned, so everything needed to try again is still there:
    // the backup, and the worlds that were in `saves/` before it.
    const left = await listBackups('p1');
    expect(left).toHaveLength(6);
    expect(left.map((b) => b.id)).toContain('2026-01-01T00-00-01-000');
    expect(left[0].reason).toBe('before-restore');
    expect(left[0].worlds).toEqual(['Home']);
  });

  it('reports a restore that worked as one, even when an old copy will not go', async () => {
    await world('Home', 'data');
    for (let i = 1; i <= 6; i++) {
      await existingBackup(`2026-01-01T00-00-0${i}-000`, 'version-change');
    }
    const remove = fs.rm.bind(fs);
    vi.spyOn(fs, 'rm').mockImplementation(async (target, options) => {
      if (String(target).includes(`${path.sep}backups${path.sep}`)) throw new Error('EBUSY');
      return remove(target, options);
    });

    await expect(restoreBackup('p1', '2026-01-01T00-00-06-000')).resolves.not.toBeNull();

    expect(await listWorlds('p1')).toEqual(['Old']);
  });
});

describe('pruning', () => {
  it('never prunes the copy it has just taken, whatever the clock says', async () => {
    // A backup's age is its id and its id is the clock's word. With the clock
    // set back — or five copies taken while it ran ahead — the new one sorts
    // oldest, and was deleted the moment it was made: a version change went
    // ahead believing it had a backup, and a restore emptied `saves/` with no
    // safety copy behind it.
    await world('Home', 'data');
    for (let i = 1; i <= 5; i++) {
      await existingBackup(`2099-01-01T00-00-0${i}-000`, 'version-change');
    }

    const fresh = await backupWorlds('p1', 'version-change');

    expect((await listBackups('p1')).map((b) => b.id)).toContain(fresh.id);
    const copied = path.join(root, 'backups', fresh.id, 'saves', 'Home', 'level.dat');
    expect(await fs.readFile(copied, 'utf-8')).toBe('data');
  });
});

describe('backup ids', () => {
  it.each(['../../etc', 'saves', '2026-01-01T00-00-01/../..', ''])(
    'refuses %j as a backup id',
    async (id) => {
      await expect(restoreBackup('p1', id)).rejects.toThrow(/Not a backup id/);
      await expect(deleteBackup('p1', id)).rejects.toThrow(/Not a backup id/);
    },
  );
});
