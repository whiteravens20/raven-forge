import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ModManifest } from '../src/shared/manifest-schema';
import type { Profile } from '../src/shared/ipc-types';

/**
 * The same promise as `config-overrides.test.ts`, but made against the real
 * sync: real files on disk, the real sync-state file, the real loop.
 *
 * The unit tests say the decision is right. This one says the decision is
 * actually wired to it — that what a sync recorded is what the next sync reads,
 * which is the half that failed before and the half a pure function cannot
 * cover.
 */

let root: string;

const profile: Profile = {
  id: 'p1',
  name: 'White Ravens Classic',
  minecraftVersion: '26.2',
  modLoader: 'fabric',
  modLoaderVersion: '0.19.3',
  allocatedRamMb: 4096,
  createdAt: '2026-08-09T00:00:00.000Z',
  updatedAt: '2026-08-09T00:00:00.000Z',
  manifestUrl: 'https://example.test/manifest.json',
};

/** What the pack's copy of a config file currently is, keyed by URL. */
const published = new Map<string, string>();

vi.mock('../src/main/window', () => ({ getMainWindow: () => null }));
vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));
vi.mock('../src/core/config/settings-manager', () => ({
  getSettings: async () => ({ trustedPublicKeys: [], autoRemoveOrphanedMods: true }),
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
    profileLockFile: () => path.join(root, 'mods.lock.json'),
    profileSyncStateFile: () => path.join(root, 'sync-state.json'),
    profileManifestCacheFile: () => path.join(root, 'manifest.cache.json'),
  },
}));

const { syncManifest } = await import('../src/core/mods/mod-sync');

const OPTIONS_URL = 'https://example.test/overrides/options.txt';

/** A manifest shipping one config override holding `content`. */
function manifestWith(content: string): ModManifest {
  published.set(OPTIONS_URL, content);
  return {
    manifestVersion: 2,
    serverName: 'White Ravens Classic',
    minecraftVersion: '26.2',
    modLoader: 'fabric',
    modLoaderVersion: '0.19.3',
    mods: [],
    resourcePacks: [],
    shaders: [],
    configFiles: [
      {
        path: 'options.txt',
        url: OPTIONS_URL,
        sha256: crypto.createHash('sha256').update(content).digest('hex'),
      },
    ],
  } as ModManifest;
}

const optionsFile = () => path.join(root, 'game', 'options.txt');
const readOptions = () => fs.readFile(optionsFile(), 'utf-8');

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-config-sync-'));
  await fs.mkdir(path.join(root, 'game'), { recursive: true });
  published.clear();
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('config overrides across repeated syncs', () => {
  it('installs the pack version into a profile that has none', async () => {
    await syncManifest('p1', manifestWith('fov:80.0\n'));
    expect(await readOptions()).toBe('fov:80.0\n');
  });

  it('keeps the settings the player changed when the pack has not moved', async () => {
    const packVersion = manifestWith('fov:80.0\n');
    await syncManifest('p1', packVersion);

    // Minecraft rewrites options.txt on exit, every session.
    await fs.writeFile(optionsFile(), 'fov:110.0\nkey_key.jump:key.keyboard.space\n');

    await syncManifest('p1', packVersion);
    expect(await readOptions()).toBe('fov:110.0\nkey_key.jump:key.keyboard.space\n');
  });

  it('survives sync after sync, not just the first one', async () => {
    const packVersion = manifestWith('fov:80.0\n');
    await syncManifest('p1', packVersion);
    await fs.writeFile(optionsFile(), 'fov:110.0\n');

    for (let i = 0; i < 5; i++) await syncManifest('p1', packVersion);
    expect(await readOptions()).toBe('fov:110.0\n');
  });

  it('still delivers a change the pack author made', async () => {
    await syncManifest('p1', manifestWith('fov:80.0\n'));
    await fs.writeFile(optionsFile(), 'fov:110.0\n');

    await syncManifest('p1', manifestWith('fov:80.0\nsimulationDistance:8\n'));
    expect(await readOptions()).toBe('fov:80.0\nsimulationDistance:8\n');
  });

  it('restores a file the player deleted', async () => {
    const packVersion = manifestWith('fov:80.0\n');
    await syncManifest('p1', packVersion);
    await fs.rm(optionsFile());

    await syncManifest('p1', packVersion);
    expect(await readOptions()).toBe('fov:80.0\n');
  });

  it('forgets a path the pack stopped shipping', async () => {
    await syncManifest('p1', manifestWith('fov:80.0\n'));

    const empty = { ...manifestWith('fov:80.0\n'), configFiles: [] } as ModManifest;
    await syncManifest('p1', empty);

    const state = JSON.parse(await fs.readFile(path.join(root, 'sync-state.json'), 'utf-8'));
    expect(state.appliedConfigs).toEqual({});
  });
});
