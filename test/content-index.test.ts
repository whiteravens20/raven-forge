import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ResourcePackEntry } from '../src/shared/manifest-schema';

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
let source: string;
let server: http.Server;
let base: string;
let served: Record<string, string>;

vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

type Content = typeof import('../src/core/mods/content-manager');

let content: Content;
const PROFILE = 'p1';

const sha256 = (body: string) => crypto.createHash('sha256').update(body).digest('hex');
const packsDir = () => path.join(root, 'data', 'profiles', PROFILE, '.minecraft', 'resourcepacks');
const indexFile = (name: string) => path.join(root, 'data', 'profiles', PROFILE, name);
const optionsFile = () => path.join(root, 'data', 'profiles', PROFILE, '.minecraft', 'options.txt');

const readIndexFile = async (name: string) =>
  JSON.parse(await fs.readFile(indexFile(name), 'utf-8'));

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-content-'));
  source = path.join(root, 'source');
  await fs.mkdir(source, { recursive: true });
  process.env.RAVENFORGE_DATA_DIR = path.join(root, 'data');

  served = {};
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

async function localZip(name: string, body = 'pack-bytes'): Promise<string> {
  const file = path.join(source, name);
  await fs.writeFile(file, body);
  return `file:${file}`;
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
  it('copies a local zip in and records it', async () => {
    const installed = await content.installContent(
      'resourcepacks',
      PROFILE,
      await localZip('Fancy.zip'),
    );

    expect(installed).toMatchObject({ name: 'Fancy', fileName: 'Fancy.zip', fromManifest: false });
    expect(await fs.readFile(path.join(packsDir(), 'Fancy.zip'), 'utf-8')).toBe('pack-bytes');
    expect(await content.listContent('resourcepacks', PROFILE)).toHaveLength(1);
  });

  it('switches a new resource pack on in the file the game reads', async () => {
    await content.installContent('resourcepacks', PROFILE, await localZip('Fancy.zip'));
    expect(await fs.readFile(optionsFile(), 'utf-8')).toContain('file/Fancy.zip');
  });

  it('does not touch options.txt for a shader', async () => {
    // Iris and OptiFine read their own config; writing this one would be a
    // change to the player's settings for no reason.
    await content.installContent('shaders', PROFILE, await localZip('Sky.zip'));
    await expect(fs.stat(optionsFile())).rejects.toThrow();
  });

  it('keeps the two indexes apart', async () => {
    await content.installContent('resourcepacks', PROFILE, await localZip('Fancy.zip'));
    await content.installContent('shaders', PROFILE, await localZip('Sky.zip'));

    expect((await content.listContent('resourcepacks', PROFILE)).map((i) => i.name)).toEqual([
      'Fancy',
    ]);
    expect((await content.listContent('shaders', PROFILE)).map((i) => i.name)).toEqual(['Sky']);
    expect(await readIndexFile('resourcepacks.lock')).toHaveLength(1);
    expect(await readIndexFile('shaders.lock')).toHaveLength(1);
  });

  it('refuses a source it does not understand', async () => {
    await expect(content.installContent('shaders', PROFILE, '/tmp/pack.zip')).rejects.toThrow(
      /Unsupported source format/,
    );
  });

  it('refuses a profile id that is not a path component', async () => {
    await expect(
      content.installContent('shaders', '../..', await localZip('a.zip')),
    ).rejects.toThrow(/Not a profile id/);
  });

  it('does not let two installs in flight lose each other', async () => {
    await Promise.all([
      content.installContent('resourcepacks', PROFILE, await localZip('A.zip', 'a')),
      content.installContent('resourcepacks', PROFILE, await localZip('B.zip', 'b')),
      content.installContent('resourcepacks', PROFILE, await localZip('C.zip', 'c')),
    ]);
    expect((await content.listContent('resourcepacks', PROFILE)).map((i) => i.name).sort()).toEqual(
      ['A', 'B', 'C'],
    );
  });
});

describe('removeContent', () => {
  it('takes the file with the entry and updates options.txt', async () => {
    const installed = await content.installContent(
      'resourcepacks',
      PROFILE,
      await localZip('Fancy.zip'),
    );
    await content.removeContent('resourcepacks', PROFILE, installed.id);

    expect(await content.listContent('resourcepacks', PROFILE)).toEqual([]);
    await expect(fs.stat(path.join(packsDir(), 'Fancy.zip'))).rejects.toThrow();
    expect(await fs.readFile(optionsFile(), 'utf-8')).not.toContain('Fancy.zip');
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
    const a = await content.installContent('resourcepacks', PROFILE, await localZip('A.zip', 'a'));
    const b = await content.installContent('resourcepacks', PROFILE, await localZip('B.zip', 'b'));

    await content.reorderResourcePacks(PROFILE, [b.id, a.id]);

    expect((await content.listContent('resourcepacks', PROFILE)).map((i) => i.name)).toEqual([
      'B',
      'A',
    ]);
    const value = await fs.readFile(optionsFile(), 'utf-8');
    expect(value.indexOf('file/A.zip')).toBeLessThan(value.indexOf('file/B.zip'));
  });

  it('keeps a pack the caller forgot to mention instead of dropping it', async () => {
    const a = await content.installContent('resourcepacks', PROFILE, await localZip('A.zip', 'a'));
    await content.installContent('resourcepacks', PROFILE, await localZip('B.zip', 'b'));

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
    expect(items[0]).toMatchObject({ id: 'server-pack', fromManifest: true, required: true });
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

  it('refuses a file whose hash is not the one the manifest published', async () => {
    const entry = manifestPack('server-pack', 'server-bytes');
    served['/server-pack.zip'] = 'something-else-entirely';

    await expect(
      content.syncContentFromManifest('resourcepacks', PROFILE, [entry], '1.21.4'),
    ).rejects.toThrow(/mismatch/);
    await expect(fs.stat(path.join(packsDir(), 'server-pack.zip'))).rejects.toThrow();
  });

  it('drops what the manifest dropped and keeps what the player installed', async () => {
    const mine = await content.installContent(
      'resourcepacks',
      PROFILE,
      await localZip('Mine.zip', 'mine'),
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
