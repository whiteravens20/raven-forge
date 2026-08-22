import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { VersionMeta } from '../src/core/minecraft/types';

/**
 * Which version meta the game is actually launched with.
 *
 * A loader install leaves a partial version meta on disk: its own `mainClass`,
 * its own libraries, and an `inheritsFrom` pointing at the vanilla version it
 * extends. Skipping it does not fail — it launches plain vanilla, with the
 * player's mods sitting in `mods/` doing nothing and no error anywhere. That
 * silence is why this is worth pinning.
 */

let root: string;

vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

// Reaching the network here would mean the profile pointed somewhere other than
// the version already in hand — a case with its own test below.
const getVersionMeta = vi.fn(async (id: string) => ({ ...vanilla, id }) as VersionMeta);
vi.mock('../src/core/minecraft/version-manifest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/minecraft/version-manifest')>();
  return {
    ...actual,
    getVersionMeta: (id: string) => getVersionMeta(id),
    resolveVersionChain: async (meta: VersionMeta) => meta,
  };
});

const vanilla = {
  id: '1.21.4',
  mainClass: 'net.minecraft.client.main.Main',
  libraries: [{ name: 'com.mojang:logging:1.0.0' }],
  arguments: { game: [], jvm: [] },
  type: 'release',
} as unknown as VersionMeta;

type LoaderProfile = typeof import('../src/core/modloader/loader-profile');
let mod: LoaderProfile;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-loader-'));
  process.env.RAVENFORGE_DATA_DIR = root;
  getVersionMeta.mockClear();

  vi.resetModules();
  const { reloadDataRoot } = await import('../src/core/config/data-root');
  reloadDataRoot();
  mod = await import('../src/core/modloader/loader-profile');
});

afterEach(async () => {
  delete process.env.RAVENFORGE_DATA_DIR;
  await fs.rm(root, { recursive: true, force: true });
});

async function writeProfile(
  loader: string,
  loaderVersion: string,
  body: Record<string, unknown>,
): Promise<void> {
  const dir = path.join(root, 'loaders', loader, `1.21.4-${loaderVersion}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${loader}-profile.json`), JSON.stringify(body));
}

const fabricProfile = {
  inheritsFrom: '1.21.4',
  mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
  libraries: [{ name: 'net.fabricmc:fabric-loader:0.17.2' }],
};

describe('resolveLaunchMeta', () => {
  it('leaves a vanilla profile exactly as it is', async () => {
    expect(await mod.resolveLaunchMeta('vanilla', undefined, '1.21.4', vanilla)).toBe(vanilla);
  });

  it('leaves a loader with no version pinned alone too', async () => {
    expect(await mod.resolveLaunchMeta('fabric', undefined, '1.21.4', vanilla)).toBe(vanilla);
  });

  it('swaps in the loader main class and its libraries', async () => {
    await writeProfile('fabric', '0.17.2', fabricProfile);

    const merged = await mod.resolveLaunchMeta('fabric', '0.17.2', '1.21.4', vanilla);
    expect(merged.mainClass).toBe('net.fabricmc.loader.impl.launch.knot.KnotClient');
    expect(merged.libraries[0].name).toBe('net.fabricmc:fabric-loader:0.17.2');
    expect(merged.libraries.map((l) => l.name)).toContain('com.mojang:logging:1.0.0');
  });

  it('falls back to vanilla when the loader was never installed', async () => {
    // Not a crash and not a lie: the launch goes ahead as vanilla, and the log
    // line is the only place this is visible.
    const merged = await mod.resolveLaunchMeta('fabric', '0.17.2', '1.21.4', vanilla);
    expect(merged).toBe(vanilla);
  });

  it('falls back to vanilla when the profile on disk will not parse', async () => {
    const dir = path.join(root, 'loaders', 'fabric', '1.21.4-0.17.2');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'fabric-profile.json'), '{ truncated');

    expect(await mod.resolveLaunchMeta('fabric', '0.17.2', '1.21.4', vanilla)).toBe(vanilla);
  });

  it('does not go back to the network for the version already in hand', async () => {
    await writeProfile('fabric', '0.17.2', fabricProfile);
    await mod.resolveLaunchMeta('fabric', '0.17.2', '1.21.4', vanilla);
    expect(getVersionMeta).not.toHaveBeenCalled();
  });

  it('fetches the parent only when the profile points somewhere else', async () => {
    await writeProfile('forge', '54.0.10', { ...fabricProfile, inheritsFrom: '1.21.3' });
    await mod.resolveLaunchMeta('forge', '54.0.10', '1.21.4', vanilla);
    expect(getVersionMeta).toHaveBeenCalledWith('1.21.3');
  });

  it('reads a profile that names no parent as extending the version in hand', async () => {
    const { inheritsFrom: _drop, ...noParent } = fabricProfile;
    await writeProfile('quilt', '0.29.1', noParent);

    const merged = await mod.resolveLaunchMeta('quilt', '0.29.1', '1.21.4', vanilla);
    expect(getVersionMeta).not.toHaveBeenCalled();
    expect(merged.mainClass).toBe('net.fabricmc.loader.impl.launch.knot.KnotClient');
  });

  it('refuses a loader version that is not a path component', async () => {
    // It becomes a directory name. `../../` here used to read a profile JSON
    // from anywhere on disk.
    await expect(mod.resolveLaunchMeta('fabric', '../../etc', '1.21.4', vanilla)).rejects.toThrow(
      /Not a version id/,
    );
  });
});
