// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ResourcePackEntry } from '../src/shared/manifest-schema';
import type { ModrinthVersion } from '../src/core/mods/modrinth-api';
import { ZipWriter } from './helpers/zip';

/**
 * Shaders and resource packs: the index, and the file the game actually reads.
 *
 * Two indexes are written by the same overlapping paths as `installed.lock` — a
 * manifest sync reconciling the whole list while the player installs something
 * from the browser — and they carry the same rule: the sync owns only the half
 * it put there. A pack installed by hand has to survive it.
 *
 * Resource packs have a second half nobody sees in the index: dropping a zip in
 * `resourcepacks/` does not switch it on. Minecraft loads what `options.txt`
 * names and nothing else, so an index the file does not agree with is a pack
 * the player installed and cannot see.
 */

let root: string;
let server: http.Server;
let base: string;
let served: Record<string, string>;
/** What Modrinth publishes, by project id: a title and the builds on offer. */
let projects: Record<string, { title: string; versions: ModrinthVersion[] }>;

vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

// Modrinth is the one place a shader or a resource pack is installed from, so
// it is what stands in here. The file itself still travels: over HTTP, from the
// server below, and is checked against the hash this publishes for it.
vi.mock('../src/core/mods/modrinth-api', async (original) => ({
  ...(await original<typeof import('../src/core/mods/modrinth-api')>()),
  getModVersions: async (projectId: string) => projects[projectId]?.versions ?? [],
  getVersion: async (versionId: string) => {
    const all = Object.values(projects).flatMap((project) => project.versions);
    const found = all.find((version) => version.id === versionId);
    if (!found) throw new Error(`No version ${versionId}`);
    return found;
  },
  getProjectTitle: async (projectId: string) => projects[projectId].title,
}));

type Content = typeof import('../src/core/mods/content-manager');

let content: Content;
const PROFILE = 'p1';

const hash = (algorithm: string, body: string) =>
  crypto.createHash(algorithm).update(body).digest('hex');
const sha256 = (body: string) => hash('sha256', body);
const packsDir = () => path.join(root, 'data', 'profiles', PROFILE, '.minecraft', 'resourcepacks');
const indexFile = (name: string) => path.join(root, 'data', 'profiles', PROFILE, name);
const optionsFile = () => path.join(root, 'data', 'profiles', PROFILE, '.minecraft', 'options.txt');

const readIndexFile = async (name: string) =>
  JSON.parse(await fs.readFile(indexFile(name), 'utf-8'));

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-content-'));
  process.env.RAVENFORGE_DATA_DIR = path.join(root, 'data');

  served = {};
  projects = {};
  server = http.createServer((req, res) => {
    const body = served[req.url ?? ''];
    if (body === undefined) {
      res.statusCode = 404;
      res.end('missing');
      return;
    }
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || !address) throw new Error('no port');
  base = `http://127.0.0.1:${address.port}`;

  vi.resetModules();
  const { reloadDataRoot } = await import('../src/core/config/data-root');
  reloadDataRoot();
  content = await import('../src/core/mods/content-manager');
});

afterEach(async () => {
  delete process.env.RAVENFORGE_DATA_DIR;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(root, { recursive: true, force: true });
});

/**
 * Publish a pack on the stand-in Modrinth and answer with its project id.
 *
 * `Fancy.zip` becomes the project `fancy`, titled `Fancy`, with one build whose
 * file is served from here.
 */
function published(fileName: string, body = 'pack-bytes'): string {
  const title = fileName.replace(/\.zip$/, '');
  const projectId = title.toLowerCase();
  served[`/${fileName}`] = body;
  projects[projectId] = {
    title,
    versions: [
      {
        id: `${projectId}-1`,
        project_id: projectId,
        version_number: '1.0.0',
        files: [
          {
            url: `${base}/${fileName}`,
            filename: fileName,
            primary: true,
            hashes: { sha1: hash('sha1', body), sha512: hash('sha512', body) },
          },
        ],
      } as ModrinthVersion,
    ],
  };
  return projectId;
}

function manifestPack(id: string, body: string): ResourcePackEntry {
  served[`/${id}.zip`] = body;
  return {
    id,
    name: id,
    source: 'url',
    url: `${base}/${id}.zip`,
    fileName: `${id}.zip`,
    sha256: sha256(body),
  } as ResourcePackEntry;
}

describe('installContent', () => {
  it('fetches the build and records it under the project it came from', async () => {
    const installed = await content.installContent(
      'resourcepacks',
      PROFILE,
      published('Fancy.zip'),
    );

    expect(installed).toMatchObject({
      id: 'fancy',
      name: 'Fancy',
      version: '1.0.0',
      source: 'modrinth',
      fileName: 'Fancy.zip',
      fromManifest: false,
    });
    expect(await fs.readFile(path.join(packsDir(), 'Fancy.zip'), 'utf-8')).toBe('pack-bytes');
    expect(await content.listContent('resourcepacks', PROFILE)).toHaveLength(1);
  });

  it('switches a new resource pack on in the file the game reads', async () => {
    await content.installContent('resourcepacks', PROFILE, published('Fancy.zip'));
    expect(await fs.readFile(optionsFile(), 'utf-8')).toContain('file/Fancy.zip');
  });

  it('does not touch options.txt for a shader', async () => {
    // Iris and OptiFine read their own config; writing this one would be a
    // change to the player's settings for no reason.
    await content.installContent('shaders', PROFILE, published('Sky.zip'));
    await expect(fs.stat(optionsFile())).rejects.toThrow();
  });

  it('keeps the two indexes apart', async () => {
    await content.installContent('resourcepacks', PROFILE, published('Fancy.zip'));
    await content.installContent('shaders', PROFILE, published('Sky.zip'));

    expect((await content.listContent('resourcepacks', PROFILE)).map((i) => i.name)).toEqual([
      'Fancy',
    ]);
    expect((await content.listContent('shaders', PROFILE)).map((i) => i.name)).toEqual(['Sky']);
    expect(await readIndexFile('resourcepacks.lock')).toHaveLength(1);
    expect(await readIndexFile('shaders.lock')).toHaveLength(1);
  });

  it('says so when the project has no build to install', async () => {
    projects.empty = { title: 'Empty', versions: [] };
    await expect(content.installContent('shaders', PROFILE, 'empty')).rejects.toThrow(
      /No shader build/,
    );
  });

  it('refuses a file that is not the one Modrinth published', async () => {
    const projectId = published('Fancy.zip');
    served['/Fancy.zip'] = 'something-else-entirely';

    await expect(content.installContent('resourcepacks', PROFILE, projectId)).rejects.toThrow(
      /mismatch/,
    );
    await expect(fs.stat(path.join(packsDir(), 'Fancy.zip'))).rejects.toThrow();
    expect(await content.listContent('resourcepacks', PROFILE)).toEqual([]);
  });

  it('installs the build it is told to, not the newest', async () => {
    const projectId = published('Fancy.zip');
    served['/Fancy-old.zip'] = 'old-bytes';
    projects[projectId].versions.push({
      id: 'fancy-0',
      project_id: projectId,
      version_number: '0.9.0',
      files: [
        {
          url: `${base}/Fancy-old.zip`,
          filename: 'Fancy-old.zip',
          primary: true,
          hashes: { sha1: hash('sha1', 'old-bytes'), sha512: hash('sha512', 'old-bytes') },
        },
      ],
    } as ModrinthVersion);

    const installed = await content.installContent('resourcepacks', PROFILE, projectId, 'fancy-0');
    expect(installed).toMatchObject({ version: '0.9.0', fileName: 'Fancy-old.zip' });
  });

  it('replaces the build a project already has installed, and takes the old file away', async () => {
    const projectId = published('Fancy.zip');
    await content.installContent('resourcepacks', PROFILE, projectId);

    served['/Fancy-2.zip'] = 'newer-bytes';
    projects[projectId].versions.unshift({
      id: 'fancy-2',
      project_id: projectId,
      version_number: '2.0.0',
      files: [
        {
          url: `${base}/Fancy-2.zip`,
          filename: 'Fancy-2.zip',
          primary: true,
          hashes: { sha1: hash('sha1', 'newer-bytes'), sha512: hash('sha512', 'newer-bytes') },
        },
      ],
    } as ModrinthVersion);
    await content.installContent('resourcepacks', PROFILE, projectId);

    const items = await content.listContent('resourcepacks', PROFILE);
    expect(items.map((item) => item.fileName)).toEqual(['Fancy-2.zip']);
    await expect(fs.stat(path.join(packsDir(), 'Fancy.zip'))).rejects.toThrow();
  });

  it('refuses a profile id that is not a path component', async () => {
    await expect(content.installContent('shaders', '../..', published('a.zip'))).rejects.toThrow(
      /Not a profile id/,
    );
  });

  it('does not let two installs in flight lose each other', async () => {
    await Promise.all([
      content.installContent('resourcepacks', PROFILE, published('A.zip', 'a')),
      content.installContent('resourcepacks', PROFILE, published('B.zip', 'b')),
      content.installContent('resourcepacks', PROFILE, published('C.zip', 'c')),
    ]);
    expect((await content.listContent('resourcepacks', PROFILE)).map((i) => i.name).sort()).toEqual(
      ['A', 'B', 'C'],
    );
  });
});

/** A zip on the player's disk, somewhere that is not the launcher's. */
async function fileOnDisk(name: string, entries: Record<string, string>): Promise<string> {
  const zip = new ZipWriter();
  for (const [entry, body] of Object.entries(entries)) zip.add(entry, body);
  const dir = path.join(root, 'downloads');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  await fs.writeFile(file, zip.toBuffer());
  return file;
}

const RESOURCE_PACK = { 'pack.mcmeta': '{"pack":{"pack_format":34}}', 'assets/x.png': 'pixels' };
const SHADER_PACK = { 'shaders/composite.fsh': 'void main() {}' };

/** The profile these packs are added to: adding to one that is not there is refused. */
async function profileExists(): Promise<void> {
  const now = '2026-10-06T00:00:00.000Z';
  await fs.mkdir(path.join(root, 'data'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'data', 'profiles.json'),
    JSON.stringify([
      {
        id: PROFILE,
        name: 'Ravens',
        minecraftVersion: '1.21.4',
        modLoader: 'fabric',
        allocatedRamMb: 4096,
        createdAt: now,
        updatedAt: now,
      },
    ]),
  );
}

async function refusalOf(err: unknown) {
  const refusal = await import('../src/core/util/refusal');
  return refusal.refusalOf(err);
}

describe('addContentFromFile', () => {
  beforeEach(profileExists);

  it('copies the pack in, lists it and leaves the original where it was', async () => {
    const file = await fileOnDisk('Faithful 32x.zip', RESOURCE_PACK);

    const added = await content.addContentFromFile('resourcepacks', PROFILE, file);

    expect(added).toMatchObject({
      name: 'Faithful 32x',
      source: 'local',
      fileName: 'Faithful 32x.zip',
      enabled: true,
      fromManifest: false,
    });
    expect(added.id).toMatch(/^local-/);
    expect(await fs.readFile(path.join(packsDir(), 'Faithful 32x.zip'))).toEqual(
      await fs.readFile(file),
    );
    expect(await content.listContent('resourcepacks', PROFILE)).toEqual([added]);
  });

  it('switches a resource pack on in the file the game reads', async () => {
    await content.addContentFromFile(
      'resourcepacks',
      PROFILE,
      await fileOnDisk('Mine.zip', RESOURCE_PACK),
    );
    expect(await fs.readFile(optionsFile(), 'utf-8')).toContain('file/Mine.zip');
  });

  it('takes a shader pack by its shaders folder, and leaves options.txt alone', async () => {
    const added = await content.addContentFromFile(
      'shaders',
      PROFILE,
      await fileOnDisk('Sky.zip', SHADER_PACK),
    );

    expect(added.fileName).toBe('Sky.zip');
    expect((await content.listContent('shaders', PROFILE)).map((i) => i.name)).toEqual(['Sky']);
    await expect(fs.stat(optionsFile())).rejects.toThrow();
  });

  it('refuses a file that is not a zip archive, whatever it is called', async () => {
    const dir = path.join(root, 'downloads');
    await fs.mkdir(dir, { recursive: true });
    const renamed = path.join(dir, 'notes.zip');
    await fs.writeFile(renamed, 'not an archive at all');
    const other = path.join(dir, 'pack.rar');
    await fs.writeFile(other, 'Rar!');

    for (const file of [renamed, other]) {
      const err = await content.addContentFromFile('resourcepacks', PROFILE, file).catch((e) => e);
      expect(await refusalOf(err)).toEqual({ key: 'contentError.notZip' });
    }
    expect(await content.listContent('resourcepacks', PROFILE)).toEqual([]);
  });

  it('refuses an archive that is not the kind of pack it is being added as', async () => {
    const shader = await fileOnDisk('Sky.zip', SHADER_PACK);
    const pack = await fileOnDisk('Mine.zip', RESOURCE_PACK);

    const asPack = await content
      .addContentFromFile('resourcepacks', PROFILE, shader)
      .catch((e) => e);
    expect(await refusalOf(asPack)).toEqual({ key: 'contentError.notResourcePack' });
    const asShader = await content.addContentFromFile('shaders', PROFILE, pack).catch((e) => e);
    expect(await refusalOf(asShader)).toEqual({ key: 'contentError.notShaderPack' });

    // Nothing was copied for either: the check comes first.
    await expect(fs.stat(path.join(packsDir(), 'Sky.zip'))).rejects.toThrow();
  });

  it('names the folder when the pack was zipped one level too high', async () => {
    // Zipping the folder instead of what is in it. The game shows nothing for
    // such a file and says nothing about why.
    const pack = await fileOnDisk('Mine.zip', {
      'Mine/pack.mcmeta': '{}',
      'Mine/assets/x.png': 'pixels',
    });
    const shader = await fileOnDisk('Sky.zip', {
      'Sky v2/shaders/composite.fsh': 'void main() {}',
    });

    const first = await content.addContentFromFile('resourcepacks', PROFILE, pack).catch((e) => e);
    expect(await refusalOf(first)).toEqual({
      key: 'contentError.nestedResourcePack',
      vars: { folder: 'Mine' },
    });
    const second = await content.addContentFromFile('shaders', PROFILE, shader).catch((e) => e);
    expect(await refusalOf(second)).toEqual({
      key: 'contentError.nestedShaderPack',
      vars: { folder: 'Sky v2' },
    });
  });

  it('will not write over a pack the modpack put there', async () => {
    await content.syncContentFromManifest(
      'resourcepacks',
      PROFILE,
      [manifestPack('server-pack', 'server-bytes')],
      '1.21.4',
    );
    const mine = await fileOnDisk('server-pack.zip', RESOURCE_PACK);

    const err = await content.addContentFromFile('resourcepacks', PROFILE, mine).catch((e) => e);

    expect(await refusalOf(err)).toEqual({
      key: 'contentError.ownedByPack',
      vars: { name: 'server-pack.zip' },
    });
    expect(await fs.readFile(path.join(packsDir(), 'server-pack.zip'), 'utf-8')).toBe(
      'server-bytes',
    );
  });

  it('takes a newer copy of a file added before, in the same place on the list', async () => {
    const first = await content.addContentFromFile(
      'resourcepacks',
      PROFILE,
      await fileOnDisk('A.zip', RESOURCE_PACK),
    );
    await content.addContentFromFile(
      'resourcepacks',
      PROFILE,
      await fileOnDisk('B.zip', RESOURCE_PACK),
    );

    const newer = await fileOnDisk('A.zip', { ...RESOURCE_PACK, 'assets/y.png': 'more pixels' });
    const again = await content.addContentFromFile('resourcepacks', PROFILE, newer);

    expect(again.id).toBe(first.id);
    expect((await content.listContent('resourcepacks', PROFILE)).map((i) => i.name)).toEqual([
      'A',
      'B',
    ]);
    expect(await fs.readFile(path.join(packsDir(), 'A.zip'))).toEqual(await fs.readFile(newer));
  });

  it('lists a pack that was dropped into the folder by hand, without touching it', async () => {
    await fs.mkdir(packsDir(), { recursive: true });
    const zip = new ZipWriter();
    for (const [entry, body] of Object.entries(RESOURCE_PACK)) zip.add(entry, body);
    const inPlace = path.join(packsDir(), 'Dropped.zip');
    await fs.writeFile(inPlace, zip.toBuffer());
    const before = await fs.readFile(inPlace);

    const added = await content.addContentFromFile('resourcepacks', PROFILE, inPlace);

    expect(added.fileName).toBe('Dropped.zip');
    expect(await fs.readFile(inPlace)).toEqual(before);
    expect(await fs.readFile(optionsFile(), 'utf-8')).toContain('file/Dropped.zip');
  });

  it('leaves no half of a pack behind when the copy does not finish', async () => {
    const file = await fileOnDisk('Mine.zip', RESOURCE_PACK);
    // A folder where the copy has to land is the portable way to make it fail.
    await fs.mkdir(path.join(packsDir(), 'Mine.zip.part'), { recursive: true });

    await expect(content.addContentFromFile('resourcepacks', PROFILE, file)).rejects.toThrow();

    expect(await content.listContent('resourcepacks', PROFILE)).toEqual([]);
    await expect(fs.stat(path.join(packsDir(), 'Mine.zip'))).rejects.toThrow();
  });

  it('refuses a profile that is not there instead of making a folder for it', async () => {
    const file = await fileOnDisk('Mine.zip', RESOURCE_PACK);
    await expect(content.addContentFromFile('resourcepacks', 'ghost', file)).rejects.toThrow(
      /not found/,
    );
    await expect(fs.stat(path.join(root, 'data', 'profiles', 'ghost'))).rejects.toThrow();
  });
});

describe('removeContent', () => {
  it('takes the file with the entry and updates options.txt', async () => {
    const installed = await content.installContent(
      'resourcepacks',
      PROFILE,
      published('Fancy.zip'),
    );
    await content.removeContent('resourcepacks', PROFILE, installed.id);

    expect(await content.listContent('resourcepacks', PROFILE)).toEqual([]);
    await expect(fs.stat(path.join(packsDir(), 'Fancy.zip'))).rejects.toThrow();
    expect(await fs.readFile(optionsFile(), 'utf-8')).not.toContain('Fancy.zip');
  });

  it('keeps the entry when the file would not go', async () => {
    // A folder under the pack's name is the portable way to make the delete
    // fail. The entry used to be dropped anyway, leaving a file the launcher
    // no longer listed and so could no longer remove.
    const installed = await content.installContent(
      'resourcepacks',
      PROFILE,
      published('Fancy.zip'),
    );
    await fs.rm(path.join(packsDir(), 'Fancy.zip'));
    await fs.mkdir(path.join(packsDir(), 'Fancy.zip'));

    await expect(content.removeContent('resourcepacks', PROFILE, installed.id)).rejects.toThrow();
    expect(await content.listContent('resourcepacks', PROFILE)).toHaveLength(1);
  });

  it('says so when there is nothing by that id', async () => {
    await expect(content.removeContent('shaders', PROFILE, 'nope')).rejects.toThrow(/not found/);
  });
});

describe('reorderResourcePacks', () => {
  it('reverses the launcher order on the way into options.txt', async () => {
    // The UI's top entry wins; Minecraft's last entry wins. The file has to be
    // the mirror of the list, or the player's ordering does the opposite of
    // what it says.
    const a = await content.installContent('resourcepacks', PROFILE, published('A.zip', 'a'));
    const b = await content.installContent('resourcepacks', PROFILE, published('B.zip', 'b'));

    await content.reorderResourcePacks(PROFILE, [b.id, a.id]);

    expect((await content.listContent('resourcepacks', PROFILE)).map((i) => i.name)).toEqual([
      'B',
      'A',
    ]);
    const value = await fs.readFile(optionsFile(), 'utf-8');
    expect(value.indexOf('file/A.zip')).toBeLessThan(value.indexOf('file/B.zip'));
  });

  it('keeps a pack the caller forgot to mention instead of dropping it', async () => {
    const a = await content.installContent('resourcepacks', PROFILE, published('A.zip', 'a'));
    await content.installContent('resourcepacks', PROFILE, published('B.zip', 'b'));

    await content.reorderResourcePacks(PROFILE, [a.id]);
    expect((await content.listContent('resourcepacks', PROFILE)).map((i) => i.name)).toEqual([
      'A',
      'B',
    ]);
  });
});

describe('syncContentFromManifest', () => {
  it('fetches what the manifest lists and marks it as manifest-owned', async () => {
    const count = await content.syncContentFromManifest(
      'resourcepacks',
      PROFILE,
      [manifestPack('server-pack', 'server-bytes')],
      '1.21.4',
    );

    expect(count).toBe(1);
    const items = await content.listContent('resourcepacks', PROFILE);
    expect(items[0]).toMatchObject({ id: 'server-pack', fromManifest: true });
    expect(await fs.readFile(path.join(packsDir(), 'server-pack.zip'), 'utf-8')).toBe(
      'server-bytes',
    );
  });

  it('does not fetch again what is already on disk and matching', async () => {
    const entry = manifestPack('server-pack', 'server-bytes');
    await content.syncContentFromManifest('resourcepacks', PROFILE, [entry], '1.21.4');

    // With nothing served, a second fetch would 404 and throw.
    served = {};
    await expect(
      content.syncContentFromManifest('resourcepacks', PROFILE, [entry], '1.21.4'),
    ).resolves.toBe(1);
  });

  it('removes the build a newer one replaced', async () => {
    // A version bump changes the file name. The old zip used to stay in the
    // folder beside the new one, in no list, for good.
    const first = { ...manifestPack('server-pack', 'build one'), fileName: 'server-pack-1.zip' };
    await content.syncContentFromManifest('resourcepacks', PROFILE, [first], '1.21.4');
    expect(await fs.readdir(packsDir())).toEqual(['server-pack-1.zip']);

    const second = { ...manifestPack('server-pack', 'build two'), fileName: 'server-pack-2.zip' };
    await content.syncContentFromManifest('resourcepacks', PROFILE, [second], '1.21.4');

    expect(await fs.readdir(packsDir())).toEqual(['server-pack-2.zip']);
    expect((await content.listContent('resourcepacks', PROFILE)).map((i) => i.fileName)).toEqual([
      'server-pack-2.zip',
    ]);
    expect(await fs.readFile(optionsFile(), 'utf-8')).not.toContain('server-pack-1.zip');
  });

  it('keeps a replaced file that another entry has taken over', async () => {
    // Two entries swap file names in one manifest: neither file is anybody's
    // leftover.
    const a1 = { ...manifestPack('a', 'pack a'), fileName: 'one.zip' };
    const b1 = { ...manifestPack('b', 'pack b'), fileName: 'two.zip' };
    await content.syncContentFromManifest('resourcepacks', PROFILE, [a1, b1], '1.21.4');

    const a2 = { ...manifestPack('a', 'pack a'), fileName: 'two.zip' };
    const b2 = { ...manifestPack('b', 'pack b'), fileName: 'one.zip' };
    await content.syncContentFromManifest('resourcepacks', PROFILE, [a2, b2], '1.21.4');

    expect((await fs.readdir(packsDir())).sort()).toEqual(['one.zip', 'two.zip']);
    expect(await fs.readFile(path.join(packsDir(), 'two.zip'), 'utf-8')).toBe('pack a');
    expect(await fs.readFile(path.join(packsDir(), 'one.zip'), 'utf-8')).toBe('pack b');
  });

  it('refuses a file whose hash is not the one the manifest published', async () => {
    const entry = manifestPack('server-pack', 'server-bytes');
    served['/server-pack.zip'] = 'something-else-entirely';

    await expect(
      content.syncContentFromManifest('resourcepacks', PROFILE, [entry], '1.21.4'),
    ).rejects.toThrow(/mismatch/);
    await expect(fs.stat(path.join(packsDir(), 'server-pack.zip'))).rejects.toThrow();
  });

  it('does not fetch again a pack named by its Modrinth project, with no hash of the manifest’s own', async () => {
    // The file was looked for under the manifest's hash alone. An entry that
    // gave none matched nothing, so the pack was fetched again at every sync —
    // which a profile that follows a pack runs before every launch.
    const entry = {
      id: 'server-pack',
      name: 'Server pack',
      source: 'modrinth',
      projectId: published('Server.zip', 'server-bytes'),
    } as ResourcePackEntry;
    await content.syncContentFromManifest('resourcepacks', PROFILE, [entry], '1.21.4');

    // With nothing served, a second fetch would 404 and throw.
    served = {};
    await expect(
      content.syncContentFromManifest('resourcepacks', PROFILE, [entry], '1.21.4'),
    ).resolves.toBe(1);
  });

  it('holds such a pack to the hash the manifest pins, when it pins one', async () => {
    // Modrinth's own hash for the build is the fallback, for an entry that
    // states none. Merged with the manifest's and the strongest taken, its
    // sha512 outranked the sha256 the publisher had signed, and the file was
    // never compared with that at all.
    const entry = {
      id: 'server-pack',
      name: 'Server pack',
      source: 'modrinth',
      projectId: published('Server.zip', 'what Modrinth serves now'),
      sha256: sha256('what the publisher signed'),
    } as ResourcePackEntry;

    await expect(
      content.syncContentFromManifest('resourcepacks', PROFILE, [entry], '1.21.4'),
    ).rejects.toThrow(/sha256 mismatch/);
    await expect(fs.stat(path.join(packsDir(), 'Server.zip'))).rejects.toThrow();
  });

  it('drops what the manifest dropped and keeps what the player installed', async () => {
    const mine = await content.installContent(
      'resourcepacks',
      PROFILE,
      published('Mine.zip', 'mine'),
    );
    await content.syncContentFromManifest(
      'resourcepacks',
      PROFILE,
      [manifestPack('server-pack', 'server-bytes')],
      '1.21.4',
    );

    await content.syncContentFromManifest('resourcepacks', PROFILE, [], '1.21.4');

    const items = await content.listContent('resourcepacks', PROFILE);
    expect(items.map((i) => i.id)).toEqual([mine.id]);
    await expect(fs.stat(path.join(packsDir(), 'server-pack.zip'))).rejects.toThrow();
    await expect(fs.stat(path.join(packsDir(), 'Mine.zip'))).resolves.toBeTruthy();
  });

  it('says which entry it cannot resolve rather than skipping it', async () => {
    await expect(
      content.syncContentFromManifest(
        'shaders',
        PROFILE,
        [{ id: 's1', name: 'Sky', source: 'local', fileName: 's1.zip' } as never],
        '1.21.4',
      ),
    ).rejects.toThrow(/Sky/);
  });
});
