// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { InstalledMod } from '../src/shared/ipc-types';

/**
 * `installed.lock`, over a real file.
 *
 * Six code paths write this file and every one of them is a read, some `await`s,
 * and a write of the whole array. Two overlapping ones used to lose whatever the
 * other did in between — or worse, produce a file that would not parse, which
 * every reader here treats as "nothing installed" while the jars are still in
 * `mods/`.
 */

let root: string;

// The real guard, over a temporary root: `profileLockFile` is where an id stops
// being a string and becomes a path, so a stub that skipped the check would test
// the wrong function.
vi.mock('../src/core/config/paths', async () => {
  const { isSafeFileName } = await import('../src/shared/manifest-schema');
  return {
    paths: {
      profileLockFile: (profileId: string) => {
        if (!isSafeFileName(profileId)) throw new Error(`Not a profile id: ${profileId}`);
        return path.join(root, `${profileId}.lock`);
      },
    },
  };
});

const { warnings } = vi.hoisted(() => ({ warnings: [] as string[] }));

vi.mock('../src/main/logger', () => ({
  log: {
    warn: (message: string) => warnings.push(message),
    info: () => {},
    error: () => {},
    debug: () => {},
  },
}));

const { readLockFile, mutateLockFile } = await import('../src/core/mods/lock-file');

const mod = (id: string): InstalledMod => ({
  id,
  name: id,
  version: '1',
  source: 'local',
  fileName: `${id}.jar`,
  enabled: true,
  fromManifest: false,
});

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-lock-'));
  warnings.length = 0;
});

const store = (contents: unknown) =>
  fs.writeFile(path.join(root, 'p1.lock'), JSON.stringify(contents));

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('readLockFile', () => {
  it('reads an absent file as nothing installed', async () => {
    expect(await readLockFile('p1')).toEqual([]);
  });

  it('reads an unparseable file as nothing installed', async () => {
    await fs.writeFile(path.join(root, 'p1.lock'), '{ not json');
    expect(await readLockFile('p1')).toEqual([]);
  });

  it('does not answer an impossible profile id with an empty list', async () => {
    // The "unreadable file means nothing installed" rule is for files. An id
    // that could never name one is a different thing and must not hide inside
    // a plausible answer.
    await expect(readLockFile('../../etc')).rejects.toThrow();
  });
});

/**
 * The file is believed an entry at a time, not as it parses.
 *
 * It used to be handed on as whatever `JSON.parse` returned. A file that held
 * something other than a list failed every operation on the profile's mods
 * with "find is not a function"; an entry with no file name failed whichever
 * one reached it; and an entry whose file name led out of the folder was a
 * path the next removal would delete.
 */
describe('a list that is not what it should be', () => {
  it('reads as nothing installed when it is not a list at all, and can be added to', async () => {
    await store({ mods: [mod('a')] });

    expect(await readLockFile('p1')).toEqual([]);

    await mutateLockFile('p1', (mods) => mods.push(mod('b')));
    expect((await readLockFile('p1')).map((m) => m.id)).toEqual(['b']);
  });

  it('leaves out what is not an entry and reads the entries beside it', async () => {
    await store([
      mod('a'),
      'a string',
      null,
      { id: 'no-file', name: 'No file' },
      { ...mod('no-id'), id: '' },
      mod('b'),
    ]);

    expect((await readLockFile('p1')).map((m) => m.id)).toEqual(['a', 'b']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('entry 2, 3, 4, 5');
  });

  it('says so once for a file, however often the file is read', async () => {
    await store([mod('a'), 7]);

    await readLockFile('p1');
    await readLockFile('p1');

    expect(warnings).toHaveLength(1);
  });

  it.each(['../../outside.jar', '..', 'mods/nested.jar', 'a\\b.jar', ''])(
    'leaves out an entry whose file name is %j, which is not a name in the folder',
    async (fileName) => {
      await store([{ ...mod('escape'), fileName }, mod('a')]);

      expect((await readLockFile('p1')).map((m) => m.id)).toEqual(['a']);
    },
  );

  it('gives a field of the wrong kind a value that harms nothing', async () => {
    await store([
      {
        id: 'odd',
        fileName: 'odd.jar',
        version: 3,
        source: 'somewhere-new',
        enabled: 'yes',
        fromManifest: 1,
        projectId: ['p'],
        updateAvailable: 'soon',
      },
    ]);

    expect(await readLockFile('p1')).toEqual([
      {
        id: 'odd',
        fileName: 'odd.jar',
        // Nobody named it, so it goes by its file.
        name: 'odd.jar',
        version: '',
        source: 'local',
        // Listed is on: it is the file's own name that is looked for.
        enabled: true,
        // The player's own, which no sync takes away.
        fromManifest: false,
      },
    ]);
  });

  it('keeps what a newer build wrote beside the fields it knows', async () => {
    await store([{ ...mod('a'), installedBy: 'a newer build' }]);

    await mutateLockFile('p1', (mods) => mods.push(mod('b')));

    const written = JSON.parse(await fs.readFile(path.join(root, 'p1.lock'), 'utf-8'));
    expect(written[0]).toMatchObject({ id: 'a', installedBy: 'a newer build' });
  });
});

describe('mutateLockFile', () => {
  it('writes back what the callback changed', async () => {
    await mutateLockFile('p1', (mods) => mods.push(mod('a')));
    expect((await readLockFile('p1')).map((m) => m.id)).toEqual(['a']);
  });

  it('keeps every concurrent addition', async () => {
    // The failure this covers: each caller reads the same empty file, appends
    // its own entry, and writes — so all but the last are lost.
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        mutateLockFile('p1', async (mods) => {
          // An await in the middle, as every real caller has: a download, a
          // hash, a round trip to Modrinth.
          await new Promise((resolve) => setTimeout(resolve, 1));
          mods.push(mod(`mod-${i}`));
        }),
      ),
    );

    const saved = await readLockFile('p1');
    expect(saved).toHaveLength(20);
    expect(new Set(saved.map((m) => m.id)).size).toBe(20);
  });

  it('does not make one profile wait for another', async () => {
    await Promise.all([
      mutateLockFile('p1', (mods) => mods.push(mod('a'))),
      mutateLockFile('p2', (mods) => mods.push(mod('b'))),
    ]);
    expect((await readLockFile('p1')).map((m) => m.id)).toEqual(['a']);
    expect((await readLockFile('p2')).map((m) => m.id)).toEqual(['b']);
  });

  it('leaves the file untouched when the callback throws, and keeps the queue alive', async () => {
    await mutateLockFile('p1', (mods) => mods.push(mod('a')));

    await expect(
      mutateLockFile('p1', () => {
        throw new Error('no');
      }),
    ).rejects.toThrow('no');

    expect((await readLockFile('p1')).map((m) => m.id)).toEqual(['a']);

    await mutateLockFile('p1', (mods) => mods.push(mod('b')));
    expect((await readLockFile('p1')).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('returns the callback’s value', async () => {
    const count = await mutateLockFile('p1', (mods) => {
      mods.push(mod('a'), mod('b'));
      return mods.length;
    });
    expect(count).toBe(2);
  });

  it('lets a replacement of the whole list see concurrent additions', async () => {
    // The manifest sync's shape: it replaces its own half of the file wholesale
    // while a hand install appends to the other half.
    await mutateLockFile('p1', (mods) => mods.push({ ...mod('from-pack'), fromManifest: true }));

    await Promise.all([
      mutateLockFile('p1', async (mods) => {
        await new Promise((resolve) => setTimeout(resolve, 2));
        const userInstalled = mods.filter((m) => !m.fromManifest);
        mods.splice(0, mods.length, { ...mod('pack-v2'), fromManifest: true }, ...userInstalled);
      }),
      mutateLockFile('p1', (mods) => mods.push(mod('by-hand'))),
    ]);

    const ids = (await readLockFile('p1')).map((m) => m.id).sort();
    expect(ids).toEqual(['by-hand', 'pack-v2']);
  });
});
