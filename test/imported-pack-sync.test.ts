// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ModManifest } from '../src/shared/manifest-schema';
import type { Profile, ProfileSyncStatus } from '../src/shared/ipc-types';

/**
 * Syncing a profile that was made from a pack file.
 *
 * Such a profile has no address to ask, so the only sync it ever got was the
 * one that created it: a second attempt stopped at "no manifest URL", with the
 * pack it had been installed from sitting in the cache unread. An install that
 * failed at mod sixty could not be finished, and a jar deleted by hand could
 * not be put back.
 */

let root: string;
let profile: Profile;

/** What each URL serves; a URL mapped to `null` fails. */
const published = new Map<string, string | null>();
/** Every URL asked for, in order. */
const fetched: string[] = [];
/** Every status the renderer was sent. */
const announced: ProfileSyncStatus[] = [];

vi.mock('../src/main/window', () => ({
  getMainWindow: () => ({
    webContents: {
      send: (channel: string, payload: ProfileSyncStatus) => {
        if (channel === 'profiles:sync-status-changed') announced.push(payload);
      },
    },
  }),
}));
vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));
vi.mock('../src/core/config/settings-manager', () => ({
  getSettings: async () => ({ trustedPublicKeys: [], downloadConcurrency: 1 }),
}));
vi.mock('../src/core/profiles/profile-manager', () => ({
  getProfile: async () => profile,
  updateProfile: async () => profile,
}));
vi.mock('../src/core/mods/content-manager', () => ({ syncContentFromManifest: async () => {} }));
vi.mock('../src/core/net/download', () => ({
  downloadToFile: async (url: string, dest: string) => {
    fetched.push(url);
    const body = published.get(url);
    if (body === null || body === undefined) throw new Error(`503 for ${url}`);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, body);
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

const { syncManifest, getProfileSyncStatus } = await import('../src/core/mods/mod-sync');

const urlOf = (file: string) => `https://example.test/mods/${file}`;

/** One pack mod, served as `<id>.jar`. */
function mod(id: string) {
  const body = `jar of ${id}`;
  published.set(urlOf(`${id}.jar`), body);
  return {
    id,
    name: id,
    version: '1.0.0',
    source: 'url' as const,
    url: urlOf(`${id}.jar`),
    fileName: `${id}.jar`,
    sha256: crypto.createHash('sha256').update(body).digest('hex'),
    required: true,
    side: 'both' as const,
  };
}

function pack(mods: ReturnType<typeof mod>[]): ModManifest {
  return {
    manifestVersion: 2,
    serverName: 'Fabulously Optimized',
    minecraftVersion: '1.21.1',
    modLoader: 'fabric',
    modLoaderVersion: '0.16.14',
    mods,
    resourcePacks: [],
    shaders: [],
    configFiles: [],
  } as ModManifest;
}

const modsDir = () => path.join(root, 'game', 'mods');
const jars = async () => (await fs.readdir(modsDir())).sort();

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-imported-pack-'));
  await fs.mkdir(modsDir(), { recursive: true });
  published.clear();
  fetched.length = 0;
  announced.length = 0;
  // No `manifestUrl`: this is what an imported `.mrpack` leaves behind.
  profile = {
    id: 'p1',
    name: 'Fabulously Optimized',
    minecraftVersion: '1.21.1',
    modLoader: 'fabric',
    modLoaderVersion: '0.16.14',
    allocatedRamMb: 4096,
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
  };
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('syncing an imported pack again', () => {
  it('finishes an install that stopped half-way, from the pack it kept', async () => {
    const first = mod('sodium');
    const broken = mod('lithium');
    const last = mod('iris');
    published.set(broken.url, null);

    await expect(syncManifest('p1', pack([first, broken, last]))).rejects.toThrow(/503/);
    expect(await jars()).toEqual(['sodium.jar']);

    // The retry is given nothing — there is no address, and the pack file may
    // be long gone. What it has is the copy the first attempt kept.
    published.set(broken.url, 'jar of lithium');
    fetched.length = 0;
    await syncManifest('p1');

    expect(fetched).toEqual([broken.url, last.url]);
    expect(await jars()).toEqual(['iris.jar', 'lithium.jar', 'sodium.jar']);
  });

  it('puts back a jar deleted by hand', async () => {
    const sodium = mod('sodium');
    const iris = mod('iris');
    await syncManifest('p1', pack([sodium, iris]));
    await fs.rm(path.join(modsDir(), 'iris.jar'));

    fetched.length = 0;
    await syncManifest('p1');

    expect(fetched).toEqual([iris.url]);
    expect(await jars()).toEqual(['iris.jar', 'sodium.jar']);
  });

  it('still refuses a profile that has neither an address nor a pack', async () => {
    await expect(syncManifest('p1')).rejects.toThrow(/no manifest URL/);
  });
});

describe('the sync status of an imported pack', () => {
  it('says there is a pack to sync against, once there is one', async () => {
    // A profile built by hand has nothing to offer a sync, and the page shows
    // it no button.
    expect(await getProfileSyncStatus('p1')).toEqual({
      profileId: 'p1',
      pendingUpdates: 0,
      status: 'never-synced',
    });

    await syncManifest('p1', pack([mod('sodium')]));

    expect(await getProfileSyncStatus('p1')).toMatchObject({
      status: 'synced',
      importedPack: true,
    });
  });

  it('says so after a failed install too, with the reason it failed', async () => {
    // The case the button exists for: the profile is there, half filled.
    const broken = mod('lithium');
    published.set(broken.url, null);
    await syncManifest('p1', pack([broken])).catch(() => undefined);

    expect(await getProfileSyncStatus('p1')).toMatchObject({
      status: 'error',
      errorMessage: expect.stringContaining('503'),
      importedPack: true,
    });
  });

  it('is announced the same way it is answered', async () => {
    // The page replaces what it holds with what an event carries. One that left
    // `importedPack` out would take the button away at the end of every sync.
    await syncManifest('p1', pack([mod('sodium')]));

    expect(announced.at(-1)).toEqual(await getProfileSyncStatus('p1'));
    expect(announced.at(-1)).toMatchObject({ status: 'synced', importedPack: true });
  });
});
