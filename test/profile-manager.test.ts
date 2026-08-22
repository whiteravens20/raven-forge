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

  it('picks a RAM figure when the caller expresses no preference', async () => {
    const { allocatedRamMb: _drop, ...data } = newProfile('Ravens');
    const profile = await mgr.createProfile(data as never);
    expect(profile.allocatedRamMb).toBeGreaterThan(0);
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
    await expect(mgr.deleteProfile('nope')).rejects.toThrow(/not found/);
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
});

describe('exportProfile', () => {
  it('round-trips through the import rules', async () => {
    const created = await mgr.createProfile(newProfile('Ravens'));
    const imported = await mgr.importProfile(await mgr.exportProfile(created.id));
    expect(imported.id).not.toBe(created.id);
    expect(imported.name).toBe('Ravens');
  });

  it('does not let an export carry a Java path into a new profile', async () => {
    const created = await mgr.createProfile(newProfile('Ravens'));
    const json = JSON.stringify({ ...created, customJavaPath: '/tmp/not-a-jvm' });
    expect(await mgr.importProfile(json)).not.toHaveProperty('customJavaPath');
  });
});
