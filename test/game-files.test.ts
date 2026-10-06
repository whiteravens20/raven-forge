// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Library, VersionMeta } from '../src/core/minecraft/types';

/**
 * Which game files a launch reads, fetches and unpacks.
 *
 * Every Play goes through here with the game already installed, so what it does
 * with files that are fine matters more than what it does with missing ones:
 * how much of them it reads, and whether it leaves alone a library that another
 * profile's game has loaded.
 */

vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

vi.mock('../src/main/window', () => ({ getMainWindow: () => undefined }));

vi.mock('../src/core/config/settings-manager', () => ({
  getSettings: async () => ({ downloadConcurrency: 4 }),
}));

const { ensureLibraries, ensureAssets, nativesClassifier } =
  await import('../src/core/minecraft/asset-downloader');
const { ZipWriter } = await import('../src/core/packs/zip-writer');

let dir: string;
let server: http.Server;
let base: string;
let served: Record<string, Buffer>;
let hits: string[];

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-game-files-'));
  served = {};
  hits = [];
  server = http.createServer((req, res) => {
    const url = req.url ?? '';
    hits.push(url);
    const body = served[url];
    if (!body) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(dir, { recursive: true, force: true });
});

const sha1 = (body: Buffer | string) => crypto.createHash('sha1').update(body).digest('hex');
const libs = () => path.join(dir, 'libraries');
const natives = () => path.join(dir, 'natives');
const metaOf = (libraries: Library[]) => ({ id: '1.16.5', libraries }) as unknown as VersionMeta;

/** A library the server has, described the way a version lists it. */
function library(name: string, body: string): Library & { file: string } {
  const libPath = `org/example/${name}/1.0/${name}-1.0.jar`;
  served[`/${libPath}`] = Buffer.from(body);
  return {
    file: path.join(libs(), libPath),
    name: `org.example:${name}:1.0`,
    downloads: {
      artifact: {
        path: libPath,
        url: `${base}/${libPath}`,
        sha1: sha1(body),
        size: Buffer.byteLength(body),
      },
    },
  };
}

/** A jar of native libraries, as the versions up to 1.18.2 ship them. */
async function nativesJar(name: string, files: Record<string, string>): Promise<Library> {
  const jar = path.join(dir, `${name}.jar`);
  const zip = await ZipWriter.create(jar);
  for (const [entry, body] of Object.entries(files)) await zip.addBuffer(entry, Buffer.from(body));
  await zip.finish();
  const bytes = await fs.readFile(jar);
  await fs.rm(jar);

  const jarPath = `org/lwjgl/${name}/3.2.2/${name}-3.2.2-natives.jar`;
  served[`/${jarPath}`] = bytes;
  const classifier = {
    path: jarPath,
    url: `${base}/${jarPath}`,
    sha1: sha1(bytes),
    size: bytes.length,
  };
  return {
    name: `org.lwjgl:${name}:3.2.2`,
    // Whichever machine runs this: the same jar under every name.
    natives: { linux: 'natives-here', windows: 'natives-here', osx: 'natives-here' },
    downloads: { classifiers: { 'natives-here': classifier } },
    extract: { exclude: ['META-INF/'] },
  };
}

describe('files a version lists more than once', () => {
  it('are fetched once', async () => {
    // 1.13 to 1.18.2 name each LWJGL jar once per rule set.
    const lwjgl = library('lwjgl', 'the jar');

    const classpath = await ensureLibraries(libs(), metaOf([lwjgl, { ...lwjgl }, { ...lwjgl }]));

    expect(hits).toHaveLength(1);
    // Still on the classpath as often as it was listed; the JVM does not mind.
    expect(classpath).toEqual([lwjgl.file, lwjgl.file, lwjgl.file]);
  });

  it('are fetched once when they are assets sharing one object', async () => {
    const body = Buffer.from('the same sound');
    const hash = sha1(body);
    const index = {
      objects: { 'a.ogg': { hash, size: body.length }, 'b.ogg': { hash, size: body.length } },
    };
    const indexBytes = Buffer.from(JSON.stringify(index));
    const assetsDir = path.join(dir, 'assets');
    await fs.mkdir(path.join(assetsDir, 'indexes'), { recursive: true });
    await fs.writeFile(path.join(assetsDir, 'indexes', '1.16.json'), indexBytes);
    const fetched: string[] = [];
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith('https://resources.download.minecraft.net/'))
        return realFetch(input, init);
      fetched.push(url);
      // Answered from the local server, so the transfer itself is a real one.
      served['/object'] = body;
      return realFetch(`${base}/object`, init);
    });

    try {
      await ensureAssets(assetsDir, {
        id: '1.16.5',
        assetIndex: {
          id: '1.16',
          sha1: sha1(indexBytes),
          size: indexBytes.length,
          totalSize: 0,
          url: '',
        },
      } as unknown as VersionMeta);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fetched).toHaveLength(1);
  });
});

describe('a file that is already there', () => {
  it('is taken at its size on an ordinary launch, and read back on a thorough one', async () => {
    const lib = library('guava', 'the real bytes');
    await fs.mkdir(path.dirname(lib.file), { recursive: true });
    // What rot looks like: the length the version declares, other content.
    await fs.writeFile(lib.file, 'THE REAL BYTES');

    await ensureLibraries(libs(), metaOf([lib]));
    expect(hits).toEqual([]);

    await ensureLibraries(libs(), metaOf([lib]), undefined, { thorough: true });
    expect(hits).toHaveLength(1);
    expect(await fs.readFile(lib.file, 'utf-8')).toBe('the real bytes');
  });

  it('is fetched again when its size is wrong, thorough or not', async () => {
    const lib = library('guava', 'the real bytes');
    await fs.mkdir(path.dirname(lib.file), { recursive: true });
    await fs.writeFile(lib.file, 'short');

    await ensureLibraries(libs(), metaOf([lib]));

    expect(await fs.readFile(lib.file, 'utf-8')).toBe('the real bytes');
  });

  it('is not replaced by a download that turns out wrong', async () => {
    const lib = library('guava', 'the real bytes');
    await fs.mkdir(path.dirname(lib.file), { recursive: true });
    await fs.writeFile(lib.file, 'short');
    served[`/${lib.downloads!.artifact!.path}`] = Buffer.from('not what was asked');

    await expect(ensureLibraries(libs(), metaOf([lib]))).rejects.toThrow(/Failed to download/);

    expect(await fs.readFile(lib.file, 'utf-8')).toBe('short');
    expect(await fs.readdir(path.dirname(lib.file))).toEqual([path.basename(lib.file)]);
  });
});

describe('native libraries', () => {
  it('are unpacked loose for a version that lists them the old way', async () => {
    const jar = await nativesJar('lwjgl', {
      'liblwjgl.so': 'linux build',
      'windows/x64/lwjgl.dll': 'windows build',
      'META-INF/MANIFEST.MF': 'Manifest-Version: 1.0',
      'README.txt': 'not a library',
    });

    const classpath = await ensureLibraries(libs(), metaOf([jar]), natives());

    // Flattened: the JVM does not look into subfolders of `java.library.path`.
    expect((await fs.readdir(natives())).sort()).toEqual(['liblwjgl.so', 'lwjgl.dll']);
    // Extraction only — the jar itself is not something to put on the classpath.
    expect(classpath).toEqual([]);
  });

  it('are left untouched at the next launch when nothing changed', async () => {
    // Another profile on the same version may be running with these mapped.
    // Rewriting one in place, even with the same bytes, kills that game.
    const jar = await nativesJar('lwjgl', { 'liblwjgl.so': 'linux build' });
    await ensureLibraries(libs(), metaOf([jar]), natives());
    const before = await fs.stat(path.join(natives(), 'liblwjgl.so'));

    await ensureLibraries(libs(), metaOf([jar]), natives());

    const after = await fs.stat(path.join(natives(), 'liblwjgl.so'));
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it('are replaced by a new file, not written over, when they did change', async () => {
    const jar = await nativesJar('lwjgl', { 'liblwjgl.so': 'linux build' });
    const file = path.join(natives(), 'liblwjgl.so');
    await fs.mkdir(natives(), { recursive: true });
    await fs.writeFile(file, 'an older, longer build of it');
    // Held open the way a running game holds it.
    const held = await fs.open(file, 'r');

    try {
      await ensureLibraries(libs(), metaOf([jar]), natives());

      expect(await fs.readFile(file, 'utf-8')).toBe('linux build');
      expect((await held.readFile('utf-8')).toString()).toBe('an older, longer build of it');
    } finally {
      await held.close();
    }
    expect(await fs.readdir(natives())).toEqual(['liblwjgl.so']);
  });

  it('are not unpacked for a version that puts them on the classpath', async () => {
    // From 1.19: an ordinary artifact with a `natives-<os>` classifier, which
    // LWJGL unpacks for itself.
    const modern = library('lwjgl-natives', 'a jar of natives');
    modern.name = 'org.lwjgl:lwjgl:3.3.3:natives-linux';

    const classpath = await ensureLibraries(libs(), metaOf([modern]), natives());

    expect(classpath).toEqual([modern.file]);
    await expect(fs.readdir(natives())).rejects.toThrow();
  });

  it('are found under the name that says which processor', () => {
    // The oldest versions leave that for the launcher to fill in.
    const map = { windows: 'natives-windows-${arch}', linux: 'natives-linux' };
    expect(nativesClassifier(map, 'windows', 'x64')).toBe('natives-windows-64');
    expect(nativesClassifier(map, 'windows', 'ia32')).toBe('natives-windows-32');
    expect(nativesClassifier(map, 'linux', 'x64')).toBe('natives-linux');
    expect(nativesClassifier(map, 'osx', 'arm64')).toBeUndefined();
  });
});

describe('assets a version reads by name', () => {
  const assets = () => path.join(dir, 'assets');
  const gameDir = () => path.join(dir, 'game');

  /** An index of these files, with their objects already on disk. */
  async function indexOf(
    id: string,
    files: Record<string, string>,
    flags: { virtual?: boolean; map_to_resources?: boolean },
  ): Promise<VersionMeta> {
    const objects: Record<string, { hash: string; size: number }> = {};
    for (const [name, body] of Object.entries(files)) {
      const hash = sha1(body);
      objects[name] = { hash, size: Buffer.byteLength(body) };
      const object = path.join(assets(), 'objects', hash.slice(0, 2), hash);
      await fs.mkdir(path.dirname(object), { recursive: true });
      await fs.writeFile(object, body);
    }
    const index = JSON.stringify({ ...flags, objects });
    await fs.mkdir(path.join(assets(), 'indexes'), { recursive: true });
    await fs.writeFile(path.join(assets(), 'indexes', `${id}.json`), index);
    return {
      id: '1.6.4',
      assetIndex: { id, sha1: sha1(index), size: index.length, totalSize: 0, url: '' },
    } as unknown as VersionMeta;
  }

  it('are laid out in a folder of names for 1.6 to 1.7.2', async () => {
    const meta = await indexOf(
      'legacy',
      { 'lang/en_US.lang': 'menu.quit=Quit' },
      { virtual: true },
    );

    const handed = await ensureAssets(assets(), meta, { gameDir: gameDir() });

    expect(handed).toBe(path.join(assets(), 'virtual', 'legacy'));
    expect(await fs.readFile(path.join(handed, 'lang', 'en_US.lang'), 'utf-8')).toBe(
      'menu.quit=Quit',
    );
  });

  it('are laid out in the game directory itself for everything older', async () => {
    const meta = await indexOf(
      'pre-1.6',
      { 'newsound/random/click.ogg': 'click' },
      { map_to_resources: true },
    );

    const handed = await ensureAssets(assets(), meta, { gameDir: gameDir() });

    expect(handed).toBe(path.join(gameDir(), 'resources'));
    expect(await fs.readFile(path.join(handed, 'newsound', 'random', 'click.ogg'), 'utf-8')).toBe(
      'click',
    );
  });

  it('are left where they are for a version that reads them through the index', async () => {
    const meta = await indexOf('17', { 'minecraft/lang/en_us.json': '{}' }, {});

    expect(await ensureAssets(assets(), meta, { gameDir: gameDir() })).toBe(assets());
    await expect(fs.access(path.join(assets(), 'virtual'))).rejects.toThrow();
  });

  it('are not copied again when they are already laid out', async () => {
    const meta = await indexOf('legacy', { 'icons/icon_16x16.png': 'icon' }, { virtual: true });
    const handed = await ensureAssets(assets(), meta);
    const before = await fs.stat(path.join(handed, 'icons', 'icon_16x16.png'));
    await new Promise((resolve) => setTimeout(resolve, 10));

    await ensureAssets(assets(), meta);

    expect((await fs.stat(path.join(handed, 'icons', 'icon_16x16.png'))).mtimeMs).toBe(
      before.mtimeMs,
    );
  });

  it('are refused a name that leads out of their folder', async () => {
    const meta = await indexOf('legacy', { '../../outside.txt': 'x' }, { virtual: true });

    await expect(ensureAssets(assets(), meta)).rejects.toThrow(/outside its folder/);
    await expect(fs.access(path.join(dir, 'outside.txt'))).rejects.toThrow();
  });

  it('are refused an object that is not named by a hash', async () => {
    const index = JSON.stringify({ objects: { 'a.txt': { hash: '../../etc/passwd', size: 1 } } });
    await fs.mkdir(path.join(assets(), 'indexes'), { recursive: true });
    await fs.writeFile(path.join(assets(), 'indexes', 'bad.json'), index);
    const meta = {
      id: '1.21.4',
      assetIndex: { id: 'bad', sha1: sha1(index), size: index.length, totalSize: 0, url: '' },
    } as unknown as VersionMeta;

    await expect(ensureAssets(assets(), meta)).rejects.toThrow(/a hash that is not one/);
  });
});
