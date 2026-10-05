// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ModManifest } from '../src/shared/manifest-schema';
import type { InstalledMod, Profile } from '../src/shared/ipc-types';

/**
 * What happens to a mod when the pack a profile follows stops shipping it.
 *
 * It goes — the file and the record of it. This used to hang on a setting that
 * was off by default, and off left the mod installed, the profile flagged
 * "updates available" for good, and nothing in the launcher able to clear
 * either. Run against the real sync and real files, because the failure was in
 * what was left on disk.
 */

let root: string;

const profile: Profile = {
  id: 'p1',
  name: 'White Ravens Forge',
  minecraftVersion: '1.21.1',
  modLoader: 'neoforge',
  modLoaderVersion: '21.1.209',
  allocatedRamMb: 4096,
  createdAt: '2026-10-05T00:00:00.000Z',
  updatedAt: '2026-10-05T00:00:00.000Z',
  manifestUrl: 'https://example.test/manifest.json',
};

/** What each URL serves. */
const published = new Map<string, string>();

vi.mock('../src/main/window', () => ({ getMainWindow: () => null }));
vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));
vi.mock('../src/core/config/settings-manager', () => ({
  getSettings: async () => ({ trustedPublicKeys: [] }),
}));
vi.mock('../src/core/profiles/profile-manager', () => ({ getProfile: async () => profile }));
vi.mock('../src/core/mods/content-manager', () => ({ syncContentFromManifest: async () => {} }));
vi.mock('../src/core/net/download', () => ({
  downloadToFile: async (url: string, dest: string) => {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, published.get(url)!);
  },
}));
vi.mock('../src/core/config/paths', () => ({
  paths: {
    profileGameDir: () => path.join(root, 'game'),
    profileModsDir: () => path.join(root, 'game', 'mods'),
    profileLockFile: () => path.join(root, 'installed.lock'),
    profileSyncStateFile: () => path.join(root, 'sync-state.json'),
    profileManifestCacheFile: () => path.join(root, 'manifest.cache.json'),
  },
}));

const { syncManifest, getProfileSyncStatus, toggleModEnabled } =
  await import('../src/core/mods/mod-sync');
const { mutateLockFile, readLockFile } = await import('../src/core/mods/lock-file');

/** A manifest shipping the named mods, each a one-line jar. */
function packWith(...ids: string[]): ModManifest {
  return {
    manifestVersion: 2,
    serverName: 'White Ravens Forge',
    minecraftVersion: '1.21.1',
    modLoader: 'neoforge',
    modLoaderVersion: '21.1.209',
    mods: ids.map((id) => {
      const url = `https://example.test/mods/${id}.jar`;
      const body = `jar of ${id}`;
      published.set(url, body);
      return {
        id,
        name: id,
        version: '1.0.0',
        source: 'url' as const,
        url,
        fileName: `${id}.jar`,
        sha256: crypto.createHash('sha256').update(body).digest('hex'),
        required: true,
        side: 'both' as const,
      };
    }),
    resourcePacks: [],
    shaders: [],
    configFiles: [],
  } as ModManifest;
}

const modsDir = () => path.join(root, 'game', 'mods');
const jars = async () => (await fs.readdir(modsDir())).sort();
const lockIds = async () => (await readLockFile('p1')).map((m) => m.id).sort();

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-dropped-mods-'));
  await fs.mkdir(modsDir(), { recursive: true });
  published.clear();
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('a mod the pack stops shipping', () => {
  it('is removed, file and record, by the next sync', async () => {
    await syncManifest('p1', packWith('jei', 'mekanism', 'waystones'));
    expect(await jars()).toEqual(['jei.jar', 'mekanism.jar', 'waystones.jar']);

    await syncManifest('p1', packWith('jei', 'mekanism'));

    expect(await jars()).toEqual(['jei.jar', 'mekanism.jar']);
    expect(await lockIds()).toEqual(['jei', 'mekanism']);
  });

  it('leaves the profile marked as synced, with nothing pending', async () => {
    await syncManifest('p1', packWith('jei', 'waystones'));
    await syncManifest('p1', packWith('jei'));

    // The badge used to read "updates available (1)" here, for ever.
    const status = await getProfileSyncStatus('p1');
    expect(status.status).toBe('synced');
    expect(status.pendingUpdates).toBe(0);
  });

  it('is removed even when the player had switched it off', async () => {
    // Switched off, its file is `waystones.jar.disabled` — looked for under the
    // wrong name it would be left behind.
    await syncManifest('p1', packWith('jei', 'waystones'));
    await toggleModEnabled('p1', 'waystones', false);
    expect(await jars()).toEqual(['jei.jar', 'waystones.jar.disabled']);

    await syncManifest('p1', packWith('jei'));

    expect(await jars()).toEqual(['jei.jar']);
  });

  it('never takes a mod the player installed by hand with it', async () => {
    await syncManifest('p1', packWith('jei', 'waystones'));

    // Added from the mods page: in the lock file, and not the pack's.
    const own: InstalledMod = {
      id: 'journeymap',
      name: 'JourneyMap',
      version: '6.0.0',
      source: 'modrinth',
      fileName: 'journeymap.jar',
      required: false,
      side: 'both',
      enabled: true,
      fromManifest: false,
    };
    await fs.writeFile(path.join(modsDir(), 'journeymap.jar'), 'jar of journeymap');
    await mutateLockFile('p1', (mods) => {
      mods.push(own);
    });

    await syncManifest('p1', packWith('jei'));

    expect(await jars()).toEqual(['jei.jar', 'journeymap.jar']);
    expect(await lockIds()).toEqual(['jei', 'journeymap']);
  });

  it('keeps its record when its file cannot be deleted, so the next sync tries again', async () => {
    await syncManifest('p1', packWith('jei', 'waystones'));

    // A directory where the jar should be: `rm` without `recursive` refuses it,
    // which stands in here for a file the running game holds open on Windows.
    const stuck = path.join(modsDir(), 'waystones.jar');
    await fs.rm(stuck);
    await fs.mkdir(stuck);

    await expect(syncManifest('p1', packWith('jei'))).rejects.toThrow();
    expect(await lockIds()).toEqual(['jei', 'waystones']);
    expect((await getProfileSyncStatus('p1')).status).toBe('error');

    await fs.rmdir(stuck);
    await syncManifest('p1', packWith('jei'));
    expect(await lockIds()).toEqual(['jei']);
    expect((await getProfileSyncStatus('p1')).status).toBe('synced');
  });
});
