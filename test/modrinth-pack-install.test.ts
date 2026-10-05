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

const verifyDownload = vi.fn(async (_file: string, _hashes: unknown, _label: string) => {});
vi.mock('../src/core/mods/integrity', () => ({
  verifyDownload: (file: string, hashes: unknown, label: string) =>
    verifyDownload(file, hashes, label),
}));

const readMrpack = vi.fn(async (_file: string) => ({
  name: 'Fabulously Optimized',
  version: '6.4.0',
  summary: 'Fast.',
  minecraftVersion: '1.21.1',
  modLoader: 'fabric' as const,
  modLoaderVersion: '0.16.14',
  files: [],
  overrides: new Map<string, Buffer>(),
}));
const applyOverrides = vi.fn(async (_gameDir: string, _overrides: unknown) => 0);
vi.mock('../src/core/packs/mrpack', () => ({
  readMrpack: (file: string) => readMrpack(file),
  applyOverrides: (gameDir: string, overrides: unknown) => applyOverrides(gameDir, overrides),
}));

const createProfile = vi.fn(async (data: Partial<Profile>) => ({ ...data, id: 'new' }) as Profile);
const deleteProfile = vi.fn(async (_profileId: string) => {});
vi.mock('../src/core/profiles/profile-manager', () => ({
  createProfile: (data: Partial<Profile>) => createProfile(data),
  deleteProfile: (profileId: string) => deleteProfile(profileId),
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
    verifyDownload,
    applyOverrides,
    createProfile,
    deleteProfile,
    syncManifest,
  ]) {
    mock.mockClear();
  }
  getModVersions.mockResolvedValue([packVersion]);
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

  it('checks the pack file against the published hash before opening it', async () => {
    await installer.installModrinthPack(pack);

    expect(verifyDownload).toHaveBeenCalledWith(
      expect.stringContaining(path.join(root, 'cache')),
      { sha512: 'abc' },
      'fo.mrpack',
    );
    // Verified first, read second.
    expect(verifyDownload.mock.invocationCallOrder[0]).toBeLessThan(
      readMrpack.mock.invocationCallOrder.at(-1)!,
    );
  });

  it('does not open a pack file that fails the check, and leaves nothing behind', async () => {
    readMrpack.mockClear();
    verifyDownload.mockRejectedValueOnce(new Error('hash mismatch'));

    await expect(installer.installModrinthPack(pack)).rejects.toThrow(/hash mismatch/);

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

    expect(deleteProfile).toHaveBeenCalledWith('new');
    expect(syncManifest).not.toHaveBeenCalled();
  });
});
