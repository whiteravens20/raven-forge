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

const { readLockFile, mutateLockFile } = await import('../src/core/mods/lock-file');

const mod = (id: string): InstalledMod => ({
  id,
  name: id,
  version: '1',
  source: 'local',
  fileName: `${id}.jar`,
  sha256: 'x',
  required: false,
  side: 'both',
  enabled: true,
  fromManifest: false,
});

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-lock-'));
});

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
