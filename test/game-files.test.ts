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

// Mojang's library host, stood in for by a folder of the local server.
vi.mock('../src/shared/constants', async (original) => ({
  ...(await original<typeof import('../src/shared/constants')>()),
  get MOJANG_LIBRARIES() {
    return `${base}/mojang`;
  },
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

/**
 * A fetched file is sent to the disk before it is given its name, unless the
 * next launch will look at it again anyway. Which of the game's files that is
 * depends on what the version profile says about each.
 */
describe('a game file that has just been fetched', () => {
  /** Count the flushes made while `work` runs. */
  async function flushesDuring(work: () => Promise<unknown>): Promise<number> {
    const probe = await fs.open(path.join(dir, 'probe'), 'w');
    const handles = Object.getPrototypeOf(probe) as { sync: () => Promise<void> };
    await probe.close();
    const flushed = handles.sync;
    let count = 0;
    const sync = vi.spyOn(handles, 'sync').mockImplementation(function (this: unknown) {
      count++;
      return flushed.call(this);
    });
    try {
      await work();
    } finally {
      sync.mockRestore();
    }
    return count;
  }

  it('is not also sent to the disk when it has a size and a hash to be held to', async () => {
    const guava = library('guava', 'the real bytes');

    expect(await flushesDuring(() => ensureLibraries(libs(), metaOf([guava])))).toBe(0);
    expect(await fs.readFile(guava.file, 'utf-8')).toBe('the real bytes');
  });

  it('is sent to the disk when nothing was published to hold it to', async () => {
    // Quilt names its libraries by coordinates and a repository, and nothing
    // more. Such a file is taken on sight at every later launch, so the one
    // moment it can be made sure of is now.
    const repoPath = 'org/quiltmc/quilt-loader/0.20.0/quilt-loader-0.20.0.jar';
    served[`/quilt/${repoPath}`] = Buffer.from('the loader');
    const quilt = { name: 'org.quiltmc:quilt-loader:0.20.0', url: `${base}/quilt/` };

    expect(await flushesDuring(() => ensureLibraries(libs(), metaOf([quilt])))).toBe(1);
    expect(await fs.readFile(path.join(libs(), repoPath), 'utf-8')).toBe('the loader');
  });
});

describe('a library named the way a Forge profile up to 1.12.2 names it', () => {
  const at = (repoPath: string) => path.join(libs(), repoPath);

  it('is fetched from Mojang when it names no repository at all', async () => {
    // All such a profile says about the class the game is started through.
    const repoPath = 'net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar';
    served[`/mojang/${repoPath}`] = Buffer.from('launchwrapper');

    const classpath = await ensureLibraries(
      libs(),
      metaOf([{ name: 'net.minecraft:launchwrapper:1.12' }]),
    );

    // Skipped without a word, it left the game to start without it.
    expect(classpath).toEqual([at(repoPath)]);
    expect(await fs.readFile(at(repoPath), 'utf-8')).toBe('launchwrapper');
  });

  it('is taken when any one of the hashes listed for it is the file’s', async () => {
    // Two, because the same jar was also served packed and came out different.
    const repoPath = 'org/scala-lang/scala-library/2.11.1/scala-library-2.11.1.jar';
    served[`/forge/${repoPath}`] = Buffer.from('scala, as served');
    const scala: Library = {
      name: 'org.scala-lang:scala-library:2.11.1',
      url: `${base}/forge/`,
      checksums: [sha1('scala, unpacked'), sha1('scala, as served')],
    };

    await ensureLibraries(libs(), metaOf([scala]));

    expect(await fs.readdir(path.dirname(at(repoPath)))).toEqual(['scala-library-2.11.1.jar']);

    // And read back the same way: neither hash alone is "the" hash.
    hits.length = 0;
    await ensureLibraries(libs(), metaOf([scala]), undefined, { thorough: true });
    expect(hits).toEqual([]);
  });

  it('is refused when none of them is, and leaves nothing behind', async () => {
    const repoPath = 'org/scala-lang/scala-library/2.11.1/scala-library-2.11.1.jar';
    served[`/forge/${repoPath}`] = Buffer.from('something else');
    const scala: Library = {
      name: 'org.scala-lang:scala-library:2.11.1',
      url: `${base}/forge/`,
      checksums: [sha1('scala, unpacked'), sha1('scala, as served')],
    };

    await expect(ensureLibraries(libs(), metaOf([scala]))).rejects.toThrow(/sha1 mismatch/);

    expect(await fs.readdir(path.dirname(at(repoPath)))).toEqual([]);
  });

  it('is left off the classpath when all it names is natives', async () => {
    const classpath = await ensureLibraries(
      libs(),
      metaOf([
        { name: 'org.lwjgl.lwjgl:lwjgl-platform:2.9.0', natives: { linux: 'natives-linux' } },
      ]),
    );

    expect(classpath).toEqual([]);
    expect(hits).toEqual([]);
  });
});

describe('a library only a loader’s installer can make', () => {
  const made = (body: string): Library & { file: string } => {
    const repoPath = 'net/minecraftforge/forge/1.21.1-52.1.0/forge-1.21.1-52.1.0-client.jar';
    return {
      file: path.join(libs(), repoPath),
      name: 'net.minecraftforge:forge:1.21.1-52.1.0:client',
      downloads: {
        artifact: { path: repoPath, url: '', sha1: sha1(body), size: Buffer.byteLength(body) },
      },
    };
  };

  it('is looked for, not fetched', async () => {
    const client = made('the patched client');
    await fs.mkdir(path.dirname(client.file), { recursive: true });
    await fs.writeFile(client.file, 'the patched client');

    expect(await ensureLibraries(libs(), metaOf([client]))).toEqual([client.file]);
    expect(hits).toEqual([]);
  });

  it('refuses the launch when it is not there, before anything else is fetched', async () => {
    const { refusalOf } = await import('../src/core/util/refusal');
    const other = library('guava', 'the real bytes');

    const err = await ensureLibraries(libs(), metaOf([other, made('the patched client')])).catch(
      (e: unknown) => e,
    );

    expect(refusalOf(err)).toEqual({
      key: 'launchError.loaderFileMissing',
      vars: { file: 'forge-1.21.1-52.1.0-client.jar' },
    });
    expect(hits).toEqual([]);
  });
});

/**
 * A version profile says where each of its files goes, as a path under a
 * folder of the launcher's. Mojang's are checked against Mojang's own list; a
 * loader's are whatever the loader's server sent, or whatever is in the file
 * its install left. Neither may name a place that is not under that folder.
 */
describe('a file a version profile puts outside the folder it belongs in', () => {
  const outside = () => path.join(dir, 'outside');
  const bytes = 'not a library';

  const refused = async (libraries: Library[]) => {
    await expect(ensureLibraries(libs(), metaOf(libraries), natives())).rejects.toThrow(
      /outside the target directory/,
    );
    await expect(fs.access(outside())).rejects.toThrow();
    // Refused for where it would go, before anybody is asked for it.
    expect(hits).toEqual([]);
  };

  it('is refused when it is a library given a path', async () => {
    served['/evil.jar'] = Buffer.from(bytes);
    await refused([
      {
        name: 'org.example:evil:1.0',
        downloads: {
          artifact: {
            path: '../outside/evil.jar',
            url: `${base}/evil.jar`,
            sha1: sha1(bytes),
            size: bytes.length,
          },
        },
      },
    ]);
  });

  it('is refused when it is a library named by coordinates', async () => {
    await refused([{ name: 'org.example:../../../outside/evil:1.0', url: `${base}/repo/` }]);
  });

  it('is refused when it is a jar of natives', async () => {
    const jar = await nativesJar('lwjgl', { 'liblwjgl.so': 'elf' });
    jar.downloads!.classifiers!['natives-here'].path = '../outside/natives.jar';
    await refused([jar]);
  });

  it('is refused when it is the asset index', async () => {
    const index = '{"objects":{}}';
    served['/index.json'] = Buffer.from(index);
    const meta = {
      id: '1.21.4',
      assetIndex: {
        id: '../../outside/index',
        sha1: sha1(index),
        size: index.length,
        totalSize: 0,
        url: `${base}/index.json`,
      },
    } as unknown as VersionMeta;

    await expect(ensureAssets(path.join(dir, 'assets'), meta)).rejects.toThrow(
      /outside the target directory/,
    );
    await expect(fs.access(outside())).rejects.toThrow();
    expect(hits).toEqual([]);
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
    // A second name for the same file, which is what a running game's mapping
    // of it amounts to: if the bytes under it change, the game's did.
    const mapped = path.join(dir, 'as-the-running-game-has-it');
    await fs.link(file, mapped);

    await ensureLibraries(libs(), metaOf([jar]), natives());

    expect(await fs.readFile(file, 'utf-8')).toBe('linux build');
    expect(await fs.readFile(mapped, 'utf-8')).toBe('an older, longer build of it');
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
