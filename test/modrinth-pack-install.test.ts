// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Profile } from '../src/shared/ipc-types';

/**
 * Installing a modpack picked from a Modrinth search.
 *
 * Which version arrives is decided here, from the Minecraft version and loader
 * the search was narrowed to, and the pack file is checked before it is opened
 * — it is the list of everything that then gets downloaded.
 */

vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

const getModVersions = vi.fn<(id: string, gameVersion?: string, loader?: string) => unknown>();
vi.mock('../src/core/mods/modrinth-api', () => ({
  getModVersions: (id: string, gameVersion?: string, loader?: string) =>
    getModVersions(id, gameVersion, loader),
  primaryFile: (version: { files: unknown[] }) => version.files[0],
}));

const downloadToFile = vi.fn(async (_url: string, dest: string, _opts?: unknown) => {
  await fs.writeFile(dest, 'pack bytes');
});
vi.mock('../src/core/net/download', () => ({
  downloadToFile: (url: string, dest: string, opts: unknown) => downloadToFile(url, dest, opts),
}));

/** What the pack carries as files inside itself, set by a test that cares. */
let overrides: Array<{ path: string; entry: string; size: number }> = [];
let indexed: Array<{ path: string; hashes: { sha512: string }; downloads: string[] }> = [];
const readMrpack = vi.fn(async (_file: string) => ({
  name: 'Fabulously Optimized',
  version: '6.4.0',
  summary: 'Fast.',
  minecraftVersion: '1.21.1',
  modLoader: 'fabric' as const,
  modLoaderVersion: '0.16.14',
  files: indexed,
  overrides,
}));
const applyOverrides = vi.fn(async (_gameDir: string, _packFile: string, _overrides: unknown) => 0);
vi.mock('../src/core/packs/mrpack', () => ({
  readMrpack: (file: string) => readMrpack(file),
  applyOverrides: (gameDir: string, packFile: string, wanted: unknown) =>
    applyOverrides(gameDir, packFile, wanted),
}));

const createProfile = vi.fn(async (data: Partial<Profile>) => ({ ...data, id: 'new' }) as Profile);
const deleteProfile = vi.fn(async (_profileId: string, _deleteFiles: boolean) => {});
vi.mock('../src/core/profiles/profile-manager', () => ({
  createProfile: (data: Partial<Profile>) => createProfile(data),
  deleteProfile: (profileId: string, deleteFiles: boolean) => deleteProfile(profileId, deleteFiles),
}));

const syncManifest = vi.fn(async (_profileId: string, _manifest?: unknown) => {});
vi.mock('../src/core/mods/mod-sync', () => ({
  syncManifest: (profileId: string, manifest?: unknown) => syncManifest(profileId, manifest),
}));

let root: string;
type Installer = typeof import('../src/core/packs/pack-installer');
let installer: Installer;

const packVersion = {
  id: 'v1',
  version_number: '6.4.0',
  files: [
    {
      url: 'https://cdn.modrinth.com/data/1KVo5zza/versions/v1/fo.mrpack',
      filename: 'fo.mrpack',
      hashes: { sha512: 'abc', sha1: 'def' },
      primary: true,
      size: 10,
    },
  ],
};

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-modrinth-pack-'));
  process.env.RAVENFORGE_DATA_DIR = root;
  await fs.mkdir(path.join(root, 'cache'), { recursive: true });
  vi.resetModules();
  const { reloadDataRoot } = await import('../src/core/config/data-root');
  reloadDataRoot();
  installer = await import('../src/core/packs/pack-installer');
  for (const mock of [
    getModVersions,
    downloadToFile,
    applyOverrides,
    createProfile,
    deleteProfile,
    syncManifest,
  ]) {
    mock.mockClear();
  }
  getModVersions.mockResolvedValue([packVersion]);
  overrides = [];
  indexed = [];
});

afterEach(async () => {
  delete process.env.RAVENFORGE_DATA_DIR;
  await fs.rm(root, { recursive: true, force: true });
});

const pack = { id: '1KVo5zza', name: 'Fabulously Optimized' };

describe('installModrinthPack', () => {
  it('asks for the version that fits the Minecraft version and loader given', async () => {
    await installer.installModrinthPack(pack, { gameVersion: '1.21.1', loader: 'fabric' });

    expect(getModVersions).toHaveBeenCalledWith('1KVo5zza', '1.21.1', 'fabric');
  });

  it('has the pack file checked against the published hash as it arrives', async () => {
    await installer.installModrinthPack(pack);

    // The download is what checks it, so a file that fails never exists under
    // the name this then opens.
    expect(downloadToFile).toHaveBeenCalledWith(
      packVersion.files[0].url,
      expect.stringContaining(path.join(root, 'cache')),
      expect.objectContaining({ verify: { hashes: { sha512: 'abc' }, label: 'fo.mrpack' } }),
    );
  });

  it('does not open a pack file that fails the check, and leaves nothing behind', async () => {
    readMrpack.mockClear();
    downloadToFile.mockRejectedValueOnce(new Error('sha512 mismatch for fo.mrpack'));

    await expect(installer.installModrinthPack(pack)).rejects.toThrow(/sha512 mismatch/);

    expect(readMrpack).not.toHaveBeenCalled();
    expect(createProfile).not.toHaveBeenCalled();
    expect(await fs.readdir(path.join(root, 'cache'))).toEqual([]);
  });

  it('makes a profile carrying the project icon, when that is an https address', async () => {
    const { profile } = await installer.installModrinthPack({
      ...pack,
      iconUrl: 'https://cdn.modrinth.com/data/1KVo5zza/icon.png',
    });

    expect(profile.name).toBe('Fabulously Optimized');
    expect(profile.iconUrl).toBe('https://cdn.modrinth.com/data/1KVo5zza/icon.png');
    expect(syncManifest).toHaveBeenCalled();
  });

  it('drops an icon address the renderer would refuse to load', async () => {
    const { profile } = await installer.installModrinthPack({
      ...pack,
      iconUrl: 'http://x/icon.png',
    });

    expect(profile.iconUrl).toBeUndefined();
  });

  it('says which pairing has no version, when the pack publishes none for it', async () => {
    getModVersions.mockResolvedValue([]);

    await expect(
      installer.installModrinthPack(pack, { gameVersion: '1.16.5', loader: 'neoforge' }),
    ).rejects.toThrow('Fabulously Optimized has no version for Minecraft 1.16.5 with NeoForge');
    expect(downloadToFile).not.toHaveBeenCalled();
  });
});

describe('an install that fails after the profile was made', () => {
  it('hands the profile back with the reason, instead of throwing it away', async () => {
    // A rejection carries only its message. Thrown, this left a half-filled
    // profile nobody had been told about, and every retry made another.
    syncManifest.mockRejectedValueOnce(new Error('503 for https://cdn/jei.jar'));

    const outcome = await installer.installModrinthPack(pack);

    expect(outcome.profile).toMatchObject({ id: 'new', name: 'Fabulously Optimized' });
    expect(outcome.failure).toBe('503 for https://cdn/jei.jar');
    expect(deleteProfile).not.toHaveBeenCalled();
  });

  it('reports no failure when everything arrived', async () => {
    expect(await installer.installModrinthPack(pack)).not.toHaveProperty('failure');
  });

  it('removes the profile when it stops before the pack was kept', async () => {
    // The pack is only stored by the sync. A profile abandoned before that has
    // nothing to finish its install from, so keeping it helps nobody.
    applyOverrides.mockRejectedValueOnce(new Error('ENOSPC'));

    await expect(installer.installModrinthPack(pack)).rejects.toThrow(/ENOSPC/);

    // With its files: a profile whose pack never arrived has nothing to keep.
    expect(deleteProfile).toHaveBeenCalledWith('new', true);
    expect(syncManifest).not.toHaveBeenCalled();
  });
});

describe('a mod the pack carries as a file', () => {
  const override = (file: string) => ({ path: file, entry: `overrides/${file}`, size: 1 });
  const lock = async () =>
    JSON.parse(await fs.readFile(path.join(root, 'profiles', 'new', 'installed.lock'), 'utf-8'));

  it('is written down, so the mods page can switch it off or remove it', async () => {
    // Unpacked with the rest of the overrides and, until this, known to nothing:
    // a jar in `mods/` that no list named.
    overrides = [
      override('mods/private-build.jar'),
      override('config/private-build.toml'),
      override('mods/nested/library.jar'),
    ];

    await installer.installModrinthPack(pack);

    expect(await lock()).toEqual([
      expect.objectContaining({
        name: 'private-build',
        fileName: 'private-build.jar',
        source: 'local',
        enabled: true,
        fromManifest: false,
      }),
    ]);
  });

  it('is left to the index when the index names the same file', async () => {
    overrides = [override('mods/sodium.jar')];
    indexed = [
      {
        path: 'mods/sodium.jar',
        hashes: { sha512: 'b'.repeat(128) },
        downloads: ['https://cdn.modrinth.com/data/AANobbMI/versions/v1/sodium.jar'],
      },
    ];

    await installer.installModrinthPack(pack);

    await expect(lock()).rejects.toThrow();
  });
});
