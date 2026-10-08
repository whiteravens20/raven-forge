// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Profile } from '../src/shared/ipc-types';

/**
 * `profiles.json` and the directories it names, over a real filesystem.
 *
 * Three things here are worth more than the rest. Mutations are serialized,
 * because a game exiting calls `recordPlaySession` at whatever moment it exits
 * — as likely as not while an edit is in flight — and the loser used to vanish
 * with nothing to show that anything had been lost. "Delete but keep the files"
 * has to leave the files findable again, or the offer is a lie. And the id is
 * what ties a profile to its directory, so nothing may overwrite it.
 */

let root: string;

vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

type Manager = typeof import('../src/core/profiles/profile-manager');

async function loadModule(): Promise<Manager> {
  vi.resetModules();
  const { reloadDataRoot } = await import('../src/core/config/data-root');
  reloadDataRoot();
  return import('../src/core/profiles/profile-manager');
}

const newProfile = (name: string): Omit<Profile, 'id' | 'createdAt' | 'updatedAt'> =>
  ({
    name,
    minecraftVersion: '1.21.4',
    modLoader: 'fabric',
    allocatedRamMb: 4096,
  }) as Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>;

let mgr: Manager;

const indexFile = () => path.join(root, 'profiles.json');
const keptAside = async () =>
  (await fs.readdir(root)).filter((f) => f.startsWith('profiles.json.broken-'));

/** Root ignores the mode bits, so the unreadable-file case cannot be staged. */
const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-profiles-'));
  process.env.RAVENFORGE_DATA_DIR = root;
  mgr = await loadModule();
});

afterEach(async () => {
  delete process.env.RAVENFORGE_DATA_DIR;
  await fs.rm(root, { recursive: true, force: true });
});

describe('createProfile', () => {
  it('stores the profile and makes its directories', async () => {
    const profile = await mgr.createProfile(newProfile('Ravens'));
    expect(profile.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await mgr.getProfile(profile.id)).toMatchObject({ name: 'Ravens' });
    await expect(
      fs.stat(path.join(root, 'profiles', profile.id, '.minecraft')),
    ).resolves.toBeTruthy();
  });

  it('keeps only the fields the schema declares', async () => {
    // The schema's *output* is what gets stored. Parsing and then keeping the
    // caller's object would let a field from an import ride into profiles.json
    // unexamined.
    const profile = await mgr.createProfile({
      ...newProfile('Ravens'),
      somethingNobodyDeclared: 'x',
    } as never);
    expect(profile).not.toHaveProperty('somethingNobodyDeclared');
    const onDisk = JSON.parse(await fs.readFile(path.join(root, 'profiles.json'), 'utf-8'));
    expect(onDisk[0]).not.toHaveProperty('somethingNobodyDeclared');
  });

  it('refuses a profile that names no RAM figure', async () => {
    // Every caller has one to give: the form, an import and a pack install all
    // settle it before they get here.
    const { allocatedRamMb: _drop, ...data } = newProfile('Ravens');
    await expect(mgr.createProfile(data as never)).rejects.toThrow(/allocatedRamMb/);
    expect(await mgr.getAllProfiles()).toHaveLength(0);
  });
});

describe('updateProfile', () => {
  it('changes what was asked and stamps updatedAt', async () => {
    const created = await mgr.createProfile(newProfile('Ravens'));
    await new Promise((r) => setTimeout(r, 2));
    const updated = await mgr.updateProfile(created.id, { name: 'Ravens 2' });
    expect(updated.name).toBe('Ravens 2');
    expect(updated.updatedAt > created.updatedAt).toBe(true);
  });

  it('refuses to let the id or the creation date be overwritten', async () => {
    // The id is what ties the record to its directory on disk; a rewrite would
    // orphan every file the profile owns.
    const created = await mgr.createProfile(newProfile('Ravens'));
    const updated = await mgr.updateProfile(created.id, {
      id: 'somebody-elses-id',
      createdAt: '1999-01-01T00:00:00.000Z',
    });
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
  });

  it('says so when there is no such profile', async () => {
    await expect(mgr.updateProfile('nope', { name: 'x' })).rejects.toThrow(/not found/);
  });
});

describe('mutateProfiles', () => {
  it('does not let two overlapping writes lose each other', async () => {
    // The real collision: the game exits and records a session while the user
    // has an edit in flight. Both read the same array; without serialization
    // the second one to finish wins and the other is gone without a trace.
    const a = await mgr.createProfile(newProfile('A'));
    const b = await mgr.createProfile(newProfile('B'));

    await Promise.all([
      mgr.updateProfile(a.id, { name: 'A renamed' }),
      mgr.recordPlaySession(b.id, 30),
      mgr.updateProfile(b.id, { serverIp: 'mc.example.net' }),
      mgr.recordPlaySession(a.id, 12),
    ]);

    const after = await mgr.getAllProfiles();
    expect(after.find((p) => p.id === a.id)).toMatchObject({
      name: 'A renamed',
      totalPlayTimeMinutes: 12,
    });
    expect(after.find((p) => p.id === b.id)).toMatchObject({
      serverIp: 'mc.example.net',
      totalPlayTimeMinutes: 30,
    });
  });

  it('keeps running after one mutation is rejected', async () => {
    const created = await mgr.createProfile(newProfile('Ravens'));
    await expect(mgr.updateProfile('nope', { name: 'x' })).rejects.toThrow();
    await expect(mgr.updateProfile(created.id, { name: 'still works' })).resolves.toMatchObject({
      name: 'still works',
    });
  });
});

/**
 * Absent, unreadable and unparsable are three different things, and only the
 * first is an empty list.
 *
 * Every failure to read the file used to be cached as "no profiles", and the
 * next change — creating one, a game exiting — wrote that back: one read that
 * failed on a locked file turned two profiles into one, with nothing kept.
 */
describe('reading profiles.json', () => {
  it('reads an absent file as no profiles yet', async () => {
    expect(await mgr.getAllProfiles()).toEqual([]);
  });

  it.skipIf(asRoot)('fails rather than answer an unreadable file with an empty list', async () => {
    await mgr.createProfile(newProfile('A'));
    await mgr.createProfile(newProfile('B'));
    await fs.chmod(indexFile(), 0o000);
    const fresh = await loadModule();

    await expect(fresh.getAllProfiles()).rejects.toThrow(/EACCES/);
    // The write that would have made the empty answer permanent.
    await expect(fresh.createProfile(newProfile('C'))).rejects.toThrow(/EACCES/);

    // Not remembered either: once the file can be read, it is.
    await fs.chmod(indexFile(), 0o600);
    expect((await fresh.getAllProfiles()).map((p) => p.name)).toEqual(['A', 'B']);
    expect(JSON.parse(await fs.readFile(indexFile(), 'utf-8'))).toHaveLength(2);
  });

  it('keeps a file it cannot parse beside the one that replaces it', async () => {
    const truncated = '[{ "id": "p1", "name": "Ravens"';
    await fs.writeFile(indexFile(), truncated);
    const fresh = await loadModule();

    expect(await fresh.getAllProfiles()).toEqual([]);
    await fresh.createProfile(newProfile('New'));

    const kept = await keptAside();
    expect(kept).toHaveLength(1);
    expect(await fs.readFile(path.join(root, kept[0]), 'utf-8')).toBe(truncated);
    expect(JSON.parse(await fs.readFile(indexFile(), 'utf-8'))).toHaveLength(1);
  });

  it('does the same for a file that parses but is not a list', async () => {
    await fs.writeFile(indexFile(), '{"profiles":[]}');
    const fresh = await loadModule();

    expect(await fresh.getAllProfiles()).toEqual([]);
    expect(await keptAside()).toHaveLength(1);
  });

  it('moves a broken file aside once, however many callers find it together', async () => {
    // The page asking for the list and the startup pack check arrive in the
    // same tick. Each finding the file broken for itself meant each moving it
    // aside: the second either failed on a file no longer there, or moved the
    // good one a save had put in its place.
    await fs.writeFile(indexFile(), '{ not json');
    const fresh = await loadModule();

    const answers = await Promise.all([
      fresh.getAllProfiles(),
      fresh.getAllProfiles(),
      fresh.getProfile('nobody'),
    ]);

    expect(answers).toEqual([[], [], null]);
    expect(await keptAside()).toHaveLength(1);
  });

  it('does not list a profile whose write never reached the disk', async () => {
    const saved = await mgr.createProfile(newProfile('Saved'));
    // A directory where the file belongs, which the atomic rename cannot
    // replace: the stand-in for a full disk that works for any user.
    await fs.rm(indexFile());
    await fs.mkdir(indexFile());

    await expect(mgr.createProfile(newProfile('Lost'))).rejects.toThrow();
    await expect(mgr.updateProfile(saved.id, { name: 'Renamed' })).rejects.toThrow();

    expect(await mgr.getAllProfiles()).toEqual([saved]);
  });
});

/**
 * The list used to be believed whole, as it parsed. One entry with no loader
 * named — a file somebody edited by hand — reached a window that then had
 * nothing to draw but its error screen, and every profile was out of reach
 * behind it.
 */
describe('an entry of profiles.json that is not a profile', () => {
  const stored = (over: Record<string, unknown>) => ({
    id: 'p1',
    name: 'Ravens',
    minecraftVersion: '1.21.4',
    modLoader: 'fabric',
    allocatedRamMb: 4096,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...over,
  });

  const withFile = async (entries: unknown[]): Promise<Manager> => {
    await fs.writeFile(indexFile(), JSON.stringify(entries));
    return loadModule();
  };

  const onDisk = async () => JSON.parse(await fs.readFile(indexFile(), 'utf-8')) as unknown[];

  it('is left out of the list and counted, beside the profiles that are', async () => {
    const noLoader = { id: 'p2', name: 'No loader', minecraftVersion: '1.21.4' };
    const fresh = await withFile([stored({}), noLoader, null, 'a string', 7]);

    expect((await fresh.getAllProfiles()).map((p) => p.id)).toEqual(['p1']);
    expect(await fresh.getProfile('p2')).toBeNull();
    expect(await fresh.getUnreadableProfileEntries()).toEqual({ count: 4, file: indexFile() });
  });

  it.each([
    ['no id', { id: undefined }],
    ['an id that is a path', { id: '../p1' }],
    ['no Minecraft version', { minecraftVersion: undefined }],
    ['a Minecraft version that is a path', { minecraftVersion: '1.21/../..' }],
    ['a loader this launcher does not have', { modLoader: 'rift' }],
  ])('is what an entry with %s is', async (_what, over) => {
    const fresh = await withFile([stored(over)]);

    expect(await fresh.getAllProfiles()).toEqual([]);
    expect((await fresh.getUnreadableProfileEntries()).count).toBe(1);
  });

  it('stays in the file exactly as it was, through every later write', async () => {
    const broken = { id: 'p2', name: 'No loader', minecraftVersion: '1.21.4', worlds: ['home'] };
    const fresh = await withFile([broken, stored({})]);

    const created = await fresh.createProfile(newProfile('New'));
    await fresh.updateProfile('p1', { name: 'Renamed' });
    await fresh.recordPlaySession('p1', 5);
    await fresh.deleteProfile(created.id, true);

    const entries = await onDisk();
    expect(entries).toHaveLength(2);
    expect(entries).toContainEqual(broken);
    expect(entries).toContainEqual(expect.objectContaining({ id: 'p1', name: 'Renamed' }));
    // And is still what the next start finds.
    expect((await (await loadModule()).getUnreadableProfileEntries()).count).toBe(1);
  });

  it('is the second of two entries that share an id', async () => {
    // The id is the folder: two profiles on one folder would each delete the
    // other's worlds.
    const fresh = await withFile([stored({ name: 'First' }), stored({ name: 'Second' })]);

    expect((await fresh.getAllProfiles()).map((p) => p.name)).toEqual(['First']);
    expect((await fresh.getUnreadableProfileEntries()).count).toBe(1);
  });

  it('is not offered as kept files, and cannot be deleted as them', async () => {
    // Its folder is on the disk with no profile on the list pointing at it,
    // which is what kept files look like — and those can be deleted for good.
    const dir = path.join(root, 'profiles', 'p2');
    await fs.mkdir(path.join(dir, '.minecraft', 'saves', 'home'), { recursive: true });
    await fs.writeFile(path.join(dir, 'profile.json'), JSON.stringify(stored({ id: 'p2' })));
    const fresh = await withFile([{ id: 'p2', name: 'No loader', minecraftVersion: '1.21.4' }]);

    expect(await fresh.listOrphanedProfiles()).toEqual([]);
    await expect(fresh.discardOrphanedProfile('p2')).rejects.toThrow(/live profile/);
    await expect(fresh.adoptOrphanedProfile('p2')).rejects.toThrow(/already on the list/);
    await expect(fs.stat(path.join(dir, '.minecraft', 'saves', 'home'))).resolves.toBeTruthy();
  });
});

describe('a stored profile with something wrong in it', () => {
  const withFile = async (entries: unknown[]): Promise<Manager> => {
    await fs.writeFile(indexFile(), JSON.stringify(entries));
    return loadModule();
  };

  it('is still a profile, without the fields that are not what they should be', async () => {
    const fresh = await withFile([
      {
        id: 'p1',
        minecraftVersion: '1.21.4',
        modLoader: 'fabric',
        modLoaderVersion: '../0.16.0',
        allocatedRamMb: 'plenty',
        serverIp: 25565,
        serverPort: '25565',
        notes: { text: 'hello' },
        javaArgs: ['-Xss4M'],
        totalPlayTimeMinutes: 'a while',
      },
    ]);

    const [profile] = await fresh.getAllProfiles();
    expect(profile).toMatchObject({
      id: 'p1',
      // Nobody named it; the id is what its folder is called.
      name: 'p1',
      minecraftVersion: '1.21.4',
      modLoader: 'fabric',
      allocatedRamMb: 4096,
    });
    for (const field of [
      'modLoaderVersion',
      'serverIp',
      'serverPort',
      'notes',
      'javaArgs',
      'totalPlayTimeMinutes',
    ] as const) {
      expect(profile[field], field).toBeUndefined();
    }
    expect(typeof profile.createdAt).toBe('string');
    expect(typeof profile.updatedAt).toBe('string');
    expect((await fresh.getUnreadableProfileEntries()).count).toBe(0);
  });

  it('keeps a value the editor would refuse, for the editor to show', async () => {
    // A port out of range or an address that is not one harms nothing until it
    // is used, and the form can only say what is wrong with a value it is given.
    const fresh = await withFile([
      {
        id: 'p1',
        name: 'Ravens',
        minecraftVersion: '1.21.4',
        modLoader: 'vanilla',
        allocatedRamMb: 128,
        manifestUrl: 'packs.example/manifest.json',
        serverPort: 70000,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    expect((await fresh.getAllProfiles())[0]).toMatchObject({
      allocatedRamMb: 128,
      manifestUrl: 'packs.example/manifest.json',
      serverPort: 70000,
    });
    await expect(fresh.updateProfile('p1', { name: 'Renamed' })).rejects.toThrow();
    await expect(
      fresh.updateProfile('p1', {
        allocatedRamMb: 2048,
        manifestUrl: undefined,
        serverPort: 25565,
      }),
    ).resolves.toMatchObject({ allocatedRamMb: 2048 });
  });

  it('keeps what a newer build wrote beside the fields this one knows', async () => {
    const fromTheFuture = {
      id: 'p1',
      name: 'Ravens',
      minecraftVersion: '1.21.4',
      modLoader: 'fabric',
      allocatedRamMb: 4096,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      shaderPreset: 'sunset',
    };
    const fresh = await withFile([fromTheFuture]);

    // A change to some other profile writes the whole list back.
    await fresh.createProfile(newProfile('Other'));

    const entries = JSON.parse(await fs.readFile(indexFile(), 'utf-8')) as unknown[];
    expect(entries).toContainEqual(fromTheFuture);
  });
});

describe('recordPlaySession', () => {
  it('adds play time without claiming the profile was edited', async () => {
    // `updatedAt` is what the UI reads as "you changed this". Playing is not
    // editing, so it is deliberately left alone.
    const created = await mgr.createProfile(newProfile('Ravens'));
    await new Promise((r) => setTimeout(r, 2));
    await mgr.recordPlaySession(created.id, 45);

    const after = await mgr.getProfile(created.id);
    expect(after?.totalPlayTimeMinutes).toBe(45);
    expect(after?.lastPlayed).toBeTruthy();
    expect(after?.updatedAt).toBe(created.updatedAt);
  });

  it('accumulates across sessions and ignores a negative one', async () => {
    const created = await mgr.createProfile(newProfile('Ravens'));
    await mgr.recordPlaySession(created.id, 10);
    await mgr.recordPlaySession(created.id, -5);
    await mgr.recordPlaySession(created.id, 20);
    expect((await mgr.getProfile(created.id))?.totalPlayTimeMinutes).toBe(30);
  });

  it('says nothing and does nothing for a profile that is gone', async () => {
    await expect(mgr.recordPlaySession('nope', 10)).resolves.toBeUndefined();
  });
});

describe('deleteProfile', () => {
  it('removes the entry and the files', async () => {
    const created = await mgr.createProfile(newProfile('Ravens'));
    await mgr.deleteProfile(created.id, true);
    expect(await mgr.getProfile(created.id)).toBeNull();
    await expect(fs.stat(path.join(root, 'profiles', created.id))).rejects.toThrow();
  });

  it('leaves a record beside kept files, so the folder is not an opaque UUID', async () => {
    const created = await mgr.createProfile(newProfile('Ravens'));
    await mgr.deleteProfile(created.id, false);

    expect(await mgr.getProfile(created.id)).toBeNull();
    const record = JSON.parse(
      await fs.readFile(path.join(root, 'profiles', created.id, 'profile.json'), 'utf-8'),
    );
    expect(record).toMatchObject({ id: created.id, name: 'Ravens' });
  });

  it('says so when there is no such profile', async () => {
    await expect(mgr.deleteProfile('nope', true)).rejects.toThrow(/not found/);
  });

  it.skipIf(asRoot)('says so when a file would not go, and lists what is left', async () => {
    // A world the game still has open, on Windows; here, a folder nothing may
    // be removed from. This used to be logged and answered as deleted, leaving
    // a folder named by an id, worlds and all, that no screen showed.
    const created = await mgr.createProfile(newProfile('Ravens'));
    const saves = path.join(root, 'profiles', created.id, '.minecraft', 'saves', 'World');
    await fs.mkdir(saves, { recursive: true });
    await fs.writeFile(path.join(saves, 'level.dat'), 'world');
    await fs.chmod(saves, 0o500);

    try {
      await expect(mgr.deleteProfile(created.id, true)).rejects.toThrow(/off the list/);
    } finally {
      await fs.chmod(saves, 0o700);
    }

    expect(await mgr.getProfile(created.id)).toBeNull();
    const orphans = await mgr.listOrphanedProfiles();
    expect(orphans.map((o) => o.profile.name)).toEqual(['Ravens']);
    expect(orphans[0].files.worlds).toBe(1);
    // And from there it can be deleted for good.
    await mgr.discardOrphanedProfile(created.id);
    await expect(fs.stat(path.join(root, 'profiles', created.id))).rejects.toThrow();
  });
});

describe('orphaned profiles', () => {
  it('lists kept files with what they contain', async () => {
    const created = await mgr.createProfile(newProfile('Ravens'));
    const mods = path.join(root, 'profiles', created.id, '.minecraft', 'mods');
    await fs.mkdir(mods, { recursive: true });
    await fs.writeFile(path.join(mods, 'a.jar'), 'jar');
    await mgr.deleteProfile(created.id, false);

    const orphans = await mgr.listOrphanedProfiles();
    expect(orphans).toHaveLength(1);
    expect(orphans[0].profile.name).toBe('Ravens');
    expect(orphans[0].files.mods).toBe(1);
    expect(orphans[0].files.bytes).toBeGreaterThan(0);
  });

  it('ignores a directory it cannot identify rather than guessing', async () => {
    await fs.mkdir(path.join(root, 'profiles', 'some-stray-folder'), { recursive: true });
    expect(await mgr.listOrphanedProfiles()).toHaveLength(0);
  });

  it('restores kept files under their original id', async () => {
    // A fresh id would produce an empty profile beside the files it was meant
    // to recover.
    const created = await mgr.createProfile(newProfile('Ravens'));
    await mgr.deleteProfile(created.id, false);

    const restored = await mgr.adoptOrphanedProfile(created.id);
    expect(restored.id).toBe(created.id);
    expect(await mgr.getProfile(created.id)).toMatchObject({ name: 'Ravens' });
    await expect(
      fs.stat(path.join(root, 'profiles', created.id, 'profile.json')),
    ).rejects.toThrow();
    expect(await mgr.listOrphanedProfiles()).toHaveLength(0);
  });

  it('refuses to adopt an id that is already on the list', async () => {
    const created = await mgr.createProfile(newProfile('Ravens'));
    await fs.writeFile(
      path.join(root, 'profiles', created.id, 'profile.json'),
      JSON.stringify(created),
    );
    await expect(mgr.adoptOrphanedProfile(created.id)).rejects.toThrow(/already on the list/);
  });

  it('refuses to discard the files of a live profile', async () => {
    // `discard` is a recursive delete. Pointing it at a profile that is still
    // on the list would take the running one's worlds with it.
    const created = await mgr.createProfile(newProfile('Ravens'));
    await expect(mgr.discardOrphanedProfile(created.id)).rejects.toThrow(/live profile/);
    await expect(fs.stat(path.join(root, 'profiles', created.id))).resolves.toBeTruthy();
  });

  it('refuses an id that is not a path component at all', async () => {
    await expect(mgr.discardOrphanedProfile('../..')).rejects.toThrow(/Not a profile id/);
  });
});

describe('duplicateProfile', () => {
  it('copies the settings under a new id and a name the caller chose', async () => {
    const created = await mgr.createProfile({
      ...newProfile('Ravens'),
      serverIp: 'mc.example.net',
    });
    await mgr.recordPlaySession(created.id, 60);

    const copy = await mgr.duplicateProfile(created.id, '  Ravens (kopia)  ');
    expect(copy.id).not.toBe(created.id);
    expect(copy.name).toBe('Ravens (kopia)');
    expect(copy.serverIp).toBe('mc.example.net');
    // A copy has not been played; carrying the original's hours over would be
    // a statistic about a session that never happened.
    expect(copy.totalPlayTimeMinutes).toBeUndefined();
    expect(copy.lastPlayed).toBeUndefined();
  });

  it('falls back to an English suffix only when given nothing to use', async () => {
    // The name is persisted, so it cannot be built here in one language: the
    // renderer knows which one the player chose.
    const created = await mgr.createProfile(newProfile('Ravens'));
    expect((await mgr.duplicateProfile(created.id, '   ')).name).toBe('Ravens (copy)');
  });

  /** Write a file somewhere under a profile's directory, making the way to it. */
  async function put(profileId: string, relative: string, content = relative): Promise<void> {
    const file = path.join(root, 'profiles', profileId, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }

  const has = (profileId: string, relative: string) =>
    fs.stat(path.join(root, 'profiles', profileId, relative)).then(
      () => true,
      () => false,
    );

  it('copies what the profile is made of', async () => {
    // It used to copy the record alone: a profile with a hundred mods came back
    // as an empty one of the same name.
    const created = await mgr.createProfile(newProfile('Ravens'));
    const kept = [
      'installed.lock',
      'shaders.lock',
      '.minecraft/mods/sodium.jar',
      '.minecraft/mods/off.jar.disabled',
      '.minecraft/config/sodium-options.json',
      '.minecraft/resourcepacks/faithful.zip',
      '.minecraft/shaderpacks/complementary.zip',
      '.minecraft/options.txt',
      '.minecraft/saves/New World/level.dat',
      '.minecraft/saves/New World/region/r.0.0.mca',
    ];
    for (const file of kept) await put(created.id, file);

    const copy = await mgr.duplicateProfile(created.id, 'Ravens (copy)');
    for (const file of kept) {
      expect(await has(copy.id, file), file).toBe(true);
      expect(
        await fs.readFile(path.join(root, 'profiles', copy.id, file), 'utf-8'),
        `${file} holds what the original held`,
      ).toBe(file);
    }
  });

  it('leaves the world backups and the game logs with the original', async () => {
    // The backups are copies already, of the original's worlds on another day.
    const created = await mgr.createProfile(newProfile('Ravens'));
    const left = [
      'backups/2026-01-01T00-00-00-000/saves/New World/level.dat',
      '.minecraft/logs/latest.log',
      '.minecraft/crash-reports/crash-2026-01-01.txt',
    ];
    for (const file of left) await put(created.id, file);
    await put(created.id, '.minecraft/mods/sodium.jar');

    const copy = await mgr.duplicateProfile(created.id, 'Ravens (copy)');
    for (const file of left) {
      expect(await has(copy.id, file), file).toBe(false);
      expect(await has(created.id, file), `${file} is still the original's`).toBe(true);
    }
    expect(await has(copy.id, '.minecraft/mods/sodium.jar')).toBe(true);
  });

  it('gives the copy an image of its own', async () => {
    // The copy used to show the original's file, and lost it the day the
    // original was deleted.
    const created = await mgr.createProfile(newProfile('Ravens'));
    await put(created.id, 'icon.png', 'png');
    await mgr.updateProfile(created.id, { iconPath: 'icon.png' });

    const copy = await mgr.duplicateProfile(created.id, 'Ravens (copy)');
    expect(copy.iconPath).toBe('icon.png');
    expect(await has(copy.id, 'icon.png')).toBe(true);

    await mgr.deleteProfile(created.id, true);
    expect(await has(copy.id, 'icon.png')).toBe(true);
  });

  it('still copies the settings of a profile whose directory is gone', async () => {
    const created = await mgr.createProfile(newProfile('Ravens'));
    await fs.rm(path.join(root, 'profiles', created.id), { recursive: true, force: true });
    await expect(mgr.duplicateProfile(created.id, 'Ravens (copy)')).resolves.toMatchObject({
      name: 'Ravens (copy)',
    });
  });

  it.skipIf(asRoot)('leaves no half-made profile behind when the copy fails', async () => {
    const created = await mgr.createProfile(newProfile('Ravens'));
    await put(created.id, '.minecraft/mods/a.jar');
    await put(created.id, '.minecraft/mods/unreadable.jar');
    const unreadable = path.join(root, 'profiles', created.id, '.minecraft/mods/unreadable.jar');
    await fs.chmod(unreadable, 0o000);

    await expect(mgr.duplicateProfile(created.id, 'Ravens (copy)')).rejects.toThrow();

    await fs.chmod(unreadable, 0o600);
    expect((await mgr.getAllProfiles()).map((p) => p.name)).toEqual(['Ravens']);
    expect(await fs.readdir(path.join(root, 'profiles'))).toEqual([created.id]);
  });
});

describe('exportProfile', () => {
  it('round-trips through the import rules', async () => {
    const created = await mgr.createProfile(newProfile('Ravens'));
    const imported = await mgr.importProfile(await mgr.exportProfile(created.id));
    expect(imported.profile.id).not.toBe(created.id);
    expect(imported.profile.name).toBe('Ravens');
    expect(imported.dropped).toEqual([]);
  });

  it('leaves out what is only true on this machine', async () => {
    // An export gets posted in a channel. The Java path has the account's name
    // in it as often as not, and the image is a file the export does not carry.
    const created = await mgr.createProfile({
      ...newProfile('Ravens'),
      customJavaPath: '/home/somebody/jdk-21/bin/java',
      iconPath: 'icon.png',
      javaArgs: '-Dfml.readTimeout=120',
    });
    const exported = JSON.parse(await mgr.exportProfile(created.id)) as Record<string, unknown>;
    expect(exported).not.toHaveProperty('customJavaPath');
    expect(exported).not.toHaveProperty('iconPath');
    expect(exported).toMatchObject({ name: 'Ravens', javaArgs: '-Dfml.readTimeout=120' });
  });

  it('does not let an export carry a Java path into a new profile', async () => {
    const created = await mgr.createProfile(newProfile('Ravens'));
    const json = JSON.stringify({ ...created, customJavaPath: '/tmp/not-a-jvm' });
    const imported = await mgr.importProfile(json);
    expect(imported.profile).not.toHaveProperty('customJavaPath');
    // And says so, which is what lets the UI tell the player what was left out.
    expect(imported.dropped).toEqual(['customJavaPath']);
  });

  it('reads an export back from a file', async () => {
    const created = await mgr.createProfile(newProfile('Ravens'));
    const file = path.join(root, 'ravens.json');
    await fs.writeFile(file, await mgr.exportProfile(created.id));

    expect((await mgr.importProfileFile(file)).profile.name).toBe('Ravens');
  });

  it('refuses a file far too large to be a profile before reading it', async () => {
    const file = path.join(root, 'huge.json');
    await fs.writeFile(file, Buffer.alloc(2 * 1024 * 1024, 0x20));

    await expect(mgr.importProfileFile(file)).rejects.toThrow(/too large/);
  });
});
