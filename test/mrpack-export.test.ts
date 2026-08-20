import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { InstalledMod, Profile } from '../src/shared/ipc-types';

/**
 * Exporting a profile as a `.mrpack`, read back with the launcher's own reader.
 *
 * The round trip is the point. Everything here writes a zip by hand, and a zip
 * that is subtly wrong does not announce itself — it opens in one tool and not
 * in the next, which would surface as "the pack I sent my friend does not
 * work". So every case ends at `readMrpack`, and one of them additionally hands
 * the file to `unzip`, which shares no code with any of this.
 */

let root: string;
let gameDir: string;

const profile: Profile = {
  id: 'p1',
  name: 'Hand-built',
  minecraftVersion: '1.21.4',
  modLoader: 'fabric',
  modLoaderVersion: '0.16.9',
  allocatedRamMb: 4096,
  createdAt: '2026-08-18T00:00:00.000Z',
  updatedAt: '2026-08-18T00:00:00.000Z',
};

let current: Profile = profile;
/** sha512 → the Modrinth build that file is, for the ones Modrinth knows. */
const known = new Map<string, unknown>();
let shaders: InstalledMod[] = [];
let resourcePacks: InstalledMod[] = [];
let loaderVersions: Array<{ version: string; stable: boolean }> = [];

vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));
vi.mock('../src/core/profiles/profile-manager', () => ({
  getProfile: async () => current,
}));
vi.mock('../src/core/config/paths', () => ({
  paths: {
    profileGameDir: () => gameDir,
    profileModsDir: () => path.join(gameDir, 'mods'),
    profileShadersDir: () => path.join(gameDir, 'shaderpacks'),
    profileResourcePacksDir: () => path.join(gameDir, 'resourcepacks'),
    profileLockFile: () => path.join(root, 'installed.lock'),
  },
}));
vi.mock('../src/core/mods/content-manager', () => ({
  listContent: async (kind: string) => (kind === 'shaders' ? shaders : resourcePacks),
}));
vi.mock('../src/core/modloader/loader-manager', () => ({
  getLoaderVersions: async () => loaderVersions,
}));
vi.mock('../src/core/mods/modrinth-api', () => ({
  versionsByHash: async (hashes: string[]) =>
    new Map(hashes.filter((h) => known.has(h)).map((h) => [h, known.get(h)])),
  primaryFile: (version: { files: unknown[] }) => version.files[0],
}));

const { exportProfileAsMrpack } = await import('../src/core/packs/mrpack-export');
const { readMrpack } = await import('../src/core/packs/mrpack');

const run = promisify(execFile);

/**
 * Whether this machine has `unzip`. Ubuntu, macOS and most Linux desktops do;
 * Windows does not ship one, and the tests run there too.
 */
const hasUnzip = await run('unzip', ['-v'])
  .then(() => true)
  .catch(() => false);

function mod(over: Partial<InstalledMod> & { id: string; fileName: string }): InstalledMod {
  return {
    name: over.id,
    version: '1.0.0',
    source: 'modrinth',
    required: false,
    side: 'both',
    enabled: true,
    fromManifest: false,
    ...over,
  };
}

/** A Modrinth build to be returned for a file with these contents. */
function build(filename: string, url: string) {
  return {
    id: 'v1',
    project_id: 'proj',
    version_number: '1.0.0',
    files: [
      {
        filename,
        url,
        size: 1234,
        primary: true,
        hashes: { sha1: 'a'.repeat(40), sha512: 'b'.repeat(128) },
      },
    ],
  };
}

async function write(relative: string, contents: string): Promise<void> {
  const file = path.join(gameDir, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents);
}

async function lock(mods: InstalledMod[]): Promise<void> {
  await fs.writeFile(path.join(root, 'installed.lock'), JSON.stringify(mods));
}

/** The sha512 the export will compute for a file it is about to read. */
async function hashOf(relative: string): Promise<string> {
  const crypto = await import('node:crypto');
  return crypto
    .createHash('sha512')
    .update(await fs.readFile(path.join(gameDir, relative)))
    .digest('hex');
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mrpack-export-'));
  gameDir = path.join(root, '.minecraft');
  await fs.mkdir(gameDir, { recursive: true });
  current = profile;
  known.clear();
  shaders = [];
  resourcePacks = [];
  loaderVersions = [];
  await lock([]);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const dest = () => path.join(root, 'out.mrpack');

describe('exportProfileAsMrpack', () => {
  it('writes a pack the launcher can read back', async () => {
    await write('mods/sodium.jar', 'sodium bytes');
    await lock([mod({ id: 'AANobbMI', name: 'Sodium', fileName: 'sodium.jar' })]);
    known.set(
      await hashOf('mods/sodium.jar'),
      build('sodium-0.6.13.jar', 'https://cdn.modrinth.com/sodium.jar'),
    );

    const summary = await exportProfileAsMrpack('p1', dest());
    expect(summary.files).toBe(1);
    expect(summary.bundled).toBe(0);

    const pack = await readMrpack(dest());
    expect(pack.name).toBe('Hand-built');
    expect(pack.minecraftVersion).toBe('1.21.4');
    expect(pack.modLoader).toBe('fabric');
    expect(pack.modLoaderVersion).toBe('0.16.9');
    expect(pack.files).toHaveLength(1);
    expect(pack.files[0].path).toBe('mods/sodium-0.6.13.jar');
    expect(pack.files[0].downloads).toEqual(['https://cdn.modrinth.com/sodium.jar']);
  });

  it.skipIf(!hasUnzip)('produces an archive an unrelated zip implementation accepts', async () => {
    await write('mods/private.jar', 'a jar nobody publishes');
    await write('config/example.toml', 'setting = true');
    await lock([mod({ id: 'local-1', fileName: 'private.jar', source: 'local' })]);

    await exportProfileAsMrpack('p1', dest());

    // `unzip -t` walks the central directory, re-inflates every entry and checks
    // each CRC. Nothing in this repo wrote a line of it.
    const { stdout } = await run('unzip', ['-t', dest()]);
    expect(stdout).toContain('No errors detected');
  });

  it('carries a file Modrinth does not have inside the pack', async () => {
    await write('mods/private.jar', 'a jar nobody publishes');
    await lock([mod({ id: 'local-1', fileName: 'private.jar', source: 'local' })]);

    const summary = await exportProfileAsMrpack('p1', dest());
    expect(summary).toMatchObject({ files: 0, bundled: 1, bundledBytes: 22 });

    const pack = await readMrpack(dest());
    expect(pack.files).toHaveLength(0);
    expect(pack.overrides.get('mods/private.jar')?.toString()).toBe('a jar nobody publishes');
  });

  it('carries config and options.txt so the pack is reproducible', async () => {
    await write('config/sodium-options.json', '{"quality":"fast"}');
    await write('config/nested/deep.toml', 'x = 1');
    await write('options.txt', 'fov:90');
    await write('saves/MyWorld/level.dat', 'not configuration');

    const summary = await exportProfileAsMrpack('p1', dest());
    expect(summary.overrides).toBe(3);

    const pack = await readMrpack(dest());
    expect([...pack.overrides.keys()].sort()).toEqual([
      'config/nested/deep.toml',
      'config/sodium-options.json',
      'options.txt',
    ]);
    // A world is not configuration, and a pack handed to a friend must not
    // carry the author's saves.
    expect([...pack.overrides.keys()].some((k) => k.startsWith('saves/'))).toBe(false);
  });

  it('files shaders and resource packs where the game keeps them', async () => {
    await fs.mkdir(path.join(gameDir, 'shaderpacks'), { recursive: true });
    await write('shaderpacks/complementary.zip', 'shader bytes');
    await write('resourcepacks/faithful.zip', 'pack bytes');
    shaders = [mod({ id: 's1', fileName: 'complementary.zip' })];
    resourcePacks = [mod({ id: 'r1', fileName: 'faithful.zip' })];
    known.set(
      await hashOf('shaderpacks/complementary.zip'),
      build('comp.zip', 'https://cdn/c.zip'),
    );
    known.set(await hashOf('resourcepacks/faithful.zip'), build('faith.zip', 'https://cdn/f.zip'));

    await exportProfileAsMrpack('p1', dest());

    const pack = await readMrpack(dest());
    expect(pack.files.map((f) => f.path).sort()).toEqual([
      'resourcepacks/faith.zip',
      'shaderpacks/comp.zip',
    ]);
    // A server has no use for either, and should not be told to fetch them.
    expect(pack.files.every((f) => f.env?.server === 'unsupported')).toBe(true);
  });

  it('leaves out content that is switched off', async () => {
    await write('mods/on.jar', 'on');
    await write('mods/off.jar.disabled', 'off');
    await lock([
      mod({ id: 'on', fileName: 'on.jar' }),
      mod({ id: 'off', fileName: 'off.jar', enabled: false }),
    ]);

    const summary = await exportProfileAsMrpack('p1', dest());

    expect(summary.skippedDisabled).toBe(1);
    expect(summary.bundled).toBe(1);
    const pack = await readMrpack(dest());
    expect([...pack.overrides.keys()]).toEqual(['mods/on.jar']);
  });

  it('names the loader build when the profile never pinned one', async () => {
    current = { ...profile, modLoaderVersion: undefined };
    loaderVersions = [
      { version: '0.17.0-beta', stable: false },
      { version: '0.16.14', stable: true },
    ];

    await exportProfileAsMrpack('p1', dest());

    // The format has no way to say "newest", so an unpinned profile is resolved
    // to a real build — and to a stable one, not to whatever tops the list.
    expect((await readMrpack(dest())).modLoaderVersion).toBe('0.16.14');
  });

  it('refuses rather than writing a pack whose loader version is a guess', async () => {
    current = { ...profile, modLoaderVersion: undefined };
    loaderVersions = [];

    await expect(exportProfileAsMrpack('p1', dest())).rejects.toThrow(/does not pin a fabric/);
    await expect(fs.access(dest())).rejects.toThrow();
  });

  it('leaves no half-written pack behind when packing fails', async () => {
    // Two bundled files that would land on the same name inside the archive.
    await write('mods/clash.jar', 'one');
    await lock([mod({ id: 'a', fileName: 'clash.jar' }), mod({ id: 'b', fileName: 'clash.jar' })]);

    await expect(exportProfileAsMrpack('p1', dest())).rejects.toThrow(/Duplicate entry/);
    // A truncated archive looks like a pack until somebody tries to open it.
    await expect(fs.access(dest())).rejects.toThrow();
  });
});
