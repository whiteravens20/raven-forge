// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { InstalledMod } from '../src/shared/ipc-types';
import type { ModrinthVersion } from '../src/core/mods/modrinth-api';
import { ZipWriter } from './helpers/zip';

/**
 * A mod added from a jar the player already has.
 *
 * The file comes from outside, so everything the search route is told by
 * Modrinth has to be found out here instead: whether it is a mod at all, whose
 * loader it is for, and — from its bytes — whether it is a build Modrinth
 * knows, which is what makes the entry an ordinary one.
 */

let root: string;
/** What Modrinth knows, by the sha512 of the file. */
let knownFiles: Map<string, ModrinthVersion>;
let modrinthDown: boolean;

const { installRequiredDependencies } = vi.hoisted(() => ({
  installRequiredDependencies: vi.fn(async (): Promise<string[]> => []),
}));

vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

vi.mock('../src/core/mods/modrinth-api', () => ({
  versionsByHash: async (hashes: string[]) => {
    if (modrinthDown) throw new TypeError('fetch failed');
    return new Map(
      hashes.flatMap((hash) => (knownFiles.has(hash) ? [[hash, knownFiles.get(hash)!]] : [])),
    );
  },
  getProjectTitle: async (projectId: string) =>
    ({ P7dR8mSH: 'Fabric API', AANobbMI: 'Sodium' })[projectId],
}));

// What a build needs is the sync's business, and tested there.
vi.mock('../src/core/mods/mod-sync', () => ({ installRequiredDependencies }));

type LocalMod = typeof import('../src/core/mods/local-mod');
let local: LocalMod;

const modsDir = (id: string) => path.join(root, 'data', 'profiles', id, '.minecraft', 'mods');
const lockFile = (id: string) => path.join(root, 'data', 'profiles', id, 'installed.lock');
const readLock = async (id: string): Promise<InstalledMod[]> =>
  JSON.parse(await fs.readFile(lockFile(id), 'utf-8'));

const FABRIC_MOD = { 'fabric.mod.json': '{"id":"example"}', 'Example.class': 'bytes' };
const FORGE_MOD = { 'META-INF/mods.toml': 'modLoader="javafml"', 'Example.class': 'bytes' };

async function jarOnDisk(name: string, entries: Record<string, string>): Promise<string> {
  const zip = new ZipWriter();
  for (const [entry, body] of Object.entries(entries)) zip.add(entry, body);
  const dir = path.join(root, 'downloads');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  await fs.writeFile(file, zip.toBuffer());
  return file;
}

/** Tell the stand-in Modrinth that this file is that build. */
async function publishedAs(file: string, version: Partial<ModrinthVersion>): Promise<void> {
  const hash = crypto
    .createHash('sha512')
    .update(await fs.readFile(file))
    .digest('hex');
  knownFiles.set(hash, { id: 'v1', version_number: '1.0.0', ...version } as ModrinthVersion);
}

async function refusalOf(err: unknown) {
  const refusal = await import('../src/core/util/refusal');
  return refusal.refusalOf(err);
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-local-mod-'));
  process.env.RAVENFORGE_DATA_DIR = path.join(root, 'data');
  await fs.mkdir(path.join(root, 'data'), { recursive: true });
  const now = '2026-10-06T00:00:00.000Z';
  await fs.writeFile(
    path.join(root, 'data', 'profiles.json'),
    JSON.stringify(
      ['fabric', 'quilt', 'forge', 'neoforge', 'vanilla'].map((modLoader) => ({
        id: modLoader,
        name: modLoader,
        minecraftVersion: '1.21.4',
        modLoader,
        allocatedRamMb: 4096,
        createdAt: now,
        updatedAt: now,
      })),
    ),
  );

  knownFiles = new Map();
  modrinthDown = false;
  installRequiredDependencies.mockReset().mockResolvedValue([]);

  vi.resetModules();
  const { reloadDataRoot } = await import('../src/core/config/data-root');
  reloadDataRoot();
  local = await import('../src/core/mods/local-mod');
});

afterEach(async () => {
  delete process.env.RAVENFORGE_DATA_DIR;
  await fs.rm(root, { recursive: true, force: true });
});

describe('addModFromFile', () => {
  it('copies the jar in and lists it, leaving the original where it was', async () => {
    const file = await jarOnDisk('example-1.0.jar', FABRIC_MOD);

    const added = await local.addModFromFile('fabric', file);

    expect(added).toEqual({ name: 'example-1.0', dependencies: [] });
    const [entry] = await readLock('fabric');
    expect(entry).toMatchObject({
      name: 'example-1.0',
      version: 'local',
      source: 'local',
      fileName: 'example-1.0.jar',
      enabled: true,
      fromManifest: false,
    });
    expect(entry.id).toMatch(/^local-/);
    expect(await fs.readFile(path.join(modsDir('fabric'), 'example-1.0.jar'))).toEqual(
      await fs.readFile(file),
    );
  });

  it('records it as the Modrinth build it is, and brings what that build needs', async () => {
    const file = await jarOnDisk('sodium-fabric-0.6.5.jar', FABRIC_MOD);
    await publishedAs(file, { id: 'sodium-065', project_id: 'AANobbMI', version_number: '0.6.5' });
    installRequiredDependencies.mockResolvedValue(['Fabric API']);

    const added = await local.addModFromFile('fabric', file);

    expect(added).toEqual({ name: 'Sodium', dependencies: ['Fabric API'] });
    expect(await readLock('fabric')).toEqual([
      {
        id: 'AANobbMI',
        name: 'Sodium',
        version: '0.6.5',
        source: 'modrinth',
        fileName: 'sodium-fabric-0.6.5.jar',
        enabled: true,
        fromManifest: false,
      },
    ]);
    expect(installRequiredDependencies).toHaveBeenCalledWith(
      'fabric',
      expect.objectContaining({ id: 'sodium-065' }),
    );
  });

  it('adds it as a plain file when Modrinth cannot be asked', async () => {
    modrinthDown = true;
    const file = await jarOnDisk('example-1.0.jar', FABRIC_MOD);

    await expect(local.addModFromFile('fabric', file)).resolves.toEqual({
      name: 'example-1.0',
      dependencies: [],
    });
    expect((await readLock('fabric'))[0].source).toBe('local');
    expect(installRequiredDependencies).not.toHaveBeenCalled();
  });

  it('refuses a file that is not a jar, whatever it is called', async () => {
    const dir = path.join(root, 'downloads');
    await fs.mkdir(dir, { recursive: true });
    const renamed = path.join(dir, 'notes.jar');
    await fs.writeFile(renamed, 'not an archive at all');
    const zip = await jarOnDisk('pack.zip', FABRIC_MOD);

    for (const file of [renamed, zip]) {
      const err = await local.addModFromFile('fabric', file).catch((e) => e);
      expect(await refusalOf(err)).toEqual({ key: 'contentError.notJar' });
    }
    await expect(fs.stat(lockFile('fabric'))).rejects.toThrow();
  });

  it('refuses a profile with no loader to read a mod with', async () => {
    const err = await local
      .addModFromFile('vanilla', await jarOnDisk('example.jar', FABRIC_MOD))
      .catch((e) => e);
    expect(await refusalOf(err)).toEqual({ key: 'contentError.needsLoader' });
  });

  it('refuses a mod made for a loader this profile does not run, and says which', async () => {
    const err = await local
      .addModFromFile('fabric', await jarOnDisk('example-forge.jar', FORGE_MOD))
      .catch((e) => e);

    expect(await refusalOf(err)).toEqual({
      key: 'contentError.wrongLoader',
      vars: { made: 'Forge', profile: 'Fabric' },
    });
    await expect(fs.stat(path.join(modsDir('fabric'), 'example-forge.jar'))).rejects.toThrow();
  });

  it.each([
    ['quilt', 'a Fabric mod, which Quilt loads', FABRIC_MOD],
    ['neoforge', 'a mod with Forge’s mods.toml, which NeoForge read for a while', FORGE_MOD],
    ['forge', 'a jar that says nothing about loaders', { 'Example.class': 'bytes' }],
    [
      'fabric',
      'a jar built for both families',
      { ...FABRIC_MOD, 'META-INF/mods.toml': 'modLoader="javafml"' },
    ],
  ])('lets a %s profile take %s', async (profile, _what, entries) => {
    await expect(
      local.addModFromFile(profile, await jarOnDisk('example.jar', entries)),
    ).resolves.toMatchObject({ name: 'example' });
  });

  it('will not write over a mod the modpack put there', async () => {
    await fs.mkdir(modsDir('fabric'), { recursive: true });
    await fs.writeFile(path.join(modsDir('fabric'), 'sodium.jar'), 'the pack’s build');
    await fs.writeFile(
      lockFile('fabric'),
      JSON.stringify([
        {
          id: 'sodium',
          name: 'Sodium',
          version: '0.6.5',
          source: 'modrinth',
          fileName: 'sodium.jar',
          enabled: true,
          fromManifest: true,
        },
      ]),
    );

    const err = await local
      .addModFromFile('fabric', await jarOnDisk('sodium.jar', FABRIC_MOD))
      .catch((e) => e);

    expect(await refusalOf(err)).toEqual({
      key: 'contentError.ownedByPack',
      vars: { name: 'Sodium' },
    });
    expect(await fs.readFile(path.join(modsDir('fabric'), 'sodium.jar'), 'utf-8')).toBe(
      'the pack’s build',
    );
  });

  it('takes the place of another build of the same mod instead of sitting beside it', async () => {
    // Two builds of one mod in the folder and the loader stops at "duplicate
    // mod" before the game has drawn anything.
    await fs.mkdir(modsDir('fabric'), { recursive: true });
    await fs.writeFile(path.join(modsDir('fabric'), 'sodium-0.6.0.jar'), 'old');
    await fs.writeFile(
      lockFile('fabric'),
      JSON.stringify([
        {
          id: 'AANobbMI',
          name: 'Sodium',
          version: '0.6.0',
          source: 'modrinth',
          fileName: 'sodium-0.6.0.jar',
          enabled: true,
          fromManifest: false,
        },
      ]),
    );
    const newer = await jarOnDisk('sodium-0.6.5.jar', FABRIC_MOD);
    await publishedAs(newer, { project_id: 'AANobbMI', version_number: '0.6.5' });

    await local.addModFromFile('fabric', newer);

    expect((await readLock('fabric')).map((m) => [m.id, m.version, m.fileName])).toEqual([
      ['AANobbMI', '0.6.5', 'sodium-0.6.5.jar'],
    ]);
    expect(await fs.readdir(modsDir('fabric'))).toEqual(['sodium-0.6.5.jar']);
  });

  it('leaves a mod switched off when a newer copy of it is added', async () => {
    const first = await jarOnDisk('example.jar', FABRIC_MOD);
    await local.addModFromFile('fabric', first);
    const [entry] = await readLock('fabric');
    await fs.rename(
      path.join(modsDir('fabric'), 'example.jar'),
      path.join(modsDir('fabric'), 'example.jar.disabled'),
    );
    await fs.writeFile(lockFile('fabric'), JSON.stringify([{ ...entry, enabled: false }]));

    const newer = await jarOnDisk('example.jar', { ...FABRIC_MOD, 'More.class': 'more bytes' });
    await local.addModFromFile('fabric', newer);

    const [after] = await readLock('fabric');
    expect(after).toMatchObject({ id: entry.id, enabled: false });
    expect(await fs.readdir(modsDir('fabric'))).toEqual(['example.jar.disabled']);
    expect(await fs.readFile(path.join(modsDir('fabric'), 'example.jar.disabled'))).toEqual(
      await fs.readFile(newer),
    );
  });

  it('lists a jar that was dropped into the folder by hand, without touching it', async () => {
    await fs.mkdir(modsDir('fabric'), { recursive: true });
    const zip = new ZipWriter();
    for (const [entry, body] of Object.entries(FABRIC_MOD)) zip.add(entry, body);
    const inPlace = path.join(modsDir('fabric'), 'dropped.jar');
    await fs.writeFile(inPlace, zip.toBuffer());
    const before = await fs.readFile(inPlace);

    await local.addModFromFile('fabric', inPlace);

    expect((await readLock('fabric')).map((m) => m.fileName)).toEqual(['dropped.jar']);
    expect(await fs.readFile(inPlace)).toEqual(before);
  });

  it('leaves no half of a jar behind when the copy does not finish', async () => {
    const file = await jarOnDisk('example.jar', FABRIC_MOD);
    // A folder where the copy has to land is the portable way to make it fail.
    await fs.mkdir(path.join(modsDir('fabric'), 'example.jar.part'), { recursive: true });

    await expect(local.addModFromFile('fabric', file)).rejects.toThrow();

    await expect(fs.stat(path.join(modsDir('fabric'), 'example.jar'))).rejects.toThrow();
    expect(await readLock('fabric').catch(() => [])).toEqual([]);
  });

  it('refuses a profile that is not there instead of making a folder for it', async () => {
    await expect(
      local.addModFromFile('ghost', await jarOnDisk('example.jar', FABRIC_MOD)),
    ).rejects.toThrow(/not found/);
    await expect(fs.stat(path.join(root, 'data', 'profiles', 'ghost'))).rejects.toThrow();
  });
});
