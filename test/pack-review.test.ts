// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import nacl from 'tweetnacl';
import { encodeBase64 } from 'tweetnacl-util';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { canonicalize, type SignedManifest } from '../src/core/updater/canonical';
import type { Profile } from '../src/shared/ipc-types';
import { ZipWriter } from './helpers/zip';

/**
 * A pack somebody handed over, and what it brings that nobody has looked at.
 *
 * Real archives and the real reader; what stands in is Modrinth, the network and
 * the install behind the question. What is pinned is that nothing is created
 * before the player has answered, that what they accepted is what is installed,
 * and that a list that is too long or too short is no use: only what runs, and
 * only what Modrinth did not publish.
 */

vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

/** The hashes Modrinth knows, or the failure of asking it. */
const modrinth = vi.hoisted(() => ({
  known: new Set<string>(),
  down: false,
  asked: [] as string[][],
}));
vi.mock('../src/core/mods/modrinth-api', () => ({
  versionsByHash: async (hashes: string[]) => {
    modrinth.asked.push(hashes);
    if (modrinth.down) throw new Error('net::ERR_INTERNET_DISCONNECTED');
    return new Map(hashes.filter((h) => modrinth.known.has(h)).map((h) => [h, {}]));
  },
  getModVersions: async () => [
    { version_number: '1', files: [{ url: 'x', filename: 'x', hashes: {} }] },
  ],
  primaryFile: (version: { files: unknown[] }) => version.files[0],
}));

const settings = vi.hoisted(() => ({ trustedPublicKeys: [] as unknown[] }));
vi.mock('../src/core/config/settings-manager', () => ({ getSettings: async () => settings }));

const createProfile = vi.fn(async (data: Partial<Profile>) => ({ ...data, id: 'new' }) as Profile);
vi.mock('../src/core/profiles/profile-manager', () => ({
  createProfile: (data: Partial<Profile>) => createProfile(data),
  deleteProfile: async () => {},
}));
vi.mock('../src/core/mods/mod-sync', () => ({ syncManifest: async () => {} }));
vi.mock('../src/core/mods/lock-file', () => ({ mutateLockFile: async () => {} }));

/** What is at the far end of a link: the bytes, for as long as a test leaves them. */
let served: Buffer = Buffer.alloc(0);
vi.mock('../src/core/net/download', () => ({
  downloadToFile: async (_url: string, dest: string) => {
    await fs.writeFile(dest, served);
  },
}));

let root: string;
type Installer = typeof import('../src/core/packs/pack-installer');
let installer: Installer;

const sha512 = (body: string) => crypto.createHash('sha512').update(body).digest('hex');
const modrinthUrl = (name: string) => `https://cdn.modrinth.com/data/AAAA/versions/BBBB/${name}`;

function indexed(over: Record<string, unknown> = {}) {
  return {
    path: 'mods/example.jar',
    hashes: { sha1: 'a'.repeat(40), sha512: 'b'.repeat(128) },
    env: { client: 'required', server: 'required' },
    downloads: [modrinthUrl('example.jar')],
    ...over,
  };
}

function packBytes(files: unknown[], overrides: Record<string, string> = {}): Buffer {
  const zip = new ZipWriter();
  zip.add(
    'modrinth.index.json',
    JSON.stringify({
      formatVersion: 1,
      game: 'minecraft',
      versionId: '1.0.0',
      name: 'Handed Over',
      files,
      dependencies: { minecraft: '1.21.4', 'fabric-loader': '0.16.9' },
    }),
  );
  for (const [entry, body] of Object.entries(overrides)) zip.add(entry, body);
  return zip.toBuffer();
}

async function packFile(files: unknown[], overrides: Record<string, string> = {}) {
  const file = path.join(root, 'handed-over.mrpack');
  await fs.writeFile(file, packBytes(files, overrides));
  return file;
}

const reviewOf = (result: unknown) => (result as { review: Record<string, unknown> }).review;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-pack-review-'));
  process.env.RAVENFORGE_DATA_DIR = root;
  await fs.mkdir(path.join(root, 'cache'), { recursive: true });
  modrinth.known.clear();
  modrinth.down = false;
  modrinth.asked.length = 0;
  settings.trustedPublicKeys = [];
  createProfile.mockClear();
  vi.resetModules();
  const { reloadDataRoot } = await import('../src/core/config/data-root');
  reloadDataRoot();
  installer = await import('../src/core/packs/pack-installer');
});

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.RAVENFORGE_DATA_DIR;
  await fs.rm(root, { recursive: true, force: true });
});

describe('a pack with nothing to ask about', () => {
  it('installs, when all it fetches comes from Modrinth', async () => {
    const result = await installer.importHandedOverMrpack(
      await packFile([indexed()], { 'overrides/config/mod.toml': 'x=1' }),
    );

    expect(result).toHaveProperty('profile');
    expect(modrinth.asked).toEqual([]);
  });

  it('installs, when what it carries is byte for byte what Modrinth published', async () => {
    modrinth.known.add(sha512('published jar'));

    const result = await installer.importHandedOverMrpack(
      await packFile([], { 'overrides/mods/published.jar': 'published jar' }),
    );

    expect(result).toHaveProperty('profile');
  });

  it('installs, when a file from elsewhere is one Modrinth published', async () => {
    modrinth.known.add('c'.repeat(128));
    const file = indexed({
      hashes: { sha512: 'c'.repeat(128) },
      downloads: ['https://github.com/someone/mod/releases/download/1/mod.jar'],
    });

    expect(await installer.importHandedOverMrpack(await packFile([file]))).toHaveProperty(
      'profile',
    );
  });

  it.each([
    ['a resource pack from another host', 'resourcepacks/look.zip'],
    ['a config from another host', 'config/mod.toml'],
  ])('does not count %s', async (_what, where) => {
    const file = indexed({ path: where, downloads: ['https://example.com/thing'] });

    expect(await installer.importHandedOverMrpack(await packFile([file]))).toHaveProperty(
      'profile',
    );
    expect(modrinth.asked).toEqual([]);
  });

  it('does not count what a client never gets', async () => {
    const file = indexed({
      env: { client: 'unsupported', server: 'required' },
      downloads: ['https://example.com/server-only.jar'],
    });

    expect(await installer.importHandedOverMrpack(await packFile([file]))).toHaveProperty(
      'profile',
    );
  });
});

describe('a pack that brings something nobody has looked at', () => {
  it('creates nothing, and says what and where from', async () => {
    const result = await installer.importHandedOverMrpack(
      await packFile(
        [
          indexed({
            downloads: ['https://example.com/x/mod.jar'],
            hashes: { sha512: 'd'.repeat(128) },
          }),
        ],
        { 'overrides/mods/private.jar': 'private build' },
      ),
    );

    expect(createProfile).not.toHaveBeenCalled();
    expect(reviewOf(result)).toEqual({
      name: 'Handed Over',
      unchecked: false,
      follows: false,
      unknown: [
        { path: 'mods/private.jar', from: null, key: sha512('private build') },
        { path: 'mods/example.jar', from: 'example.com', key: 'd'.repeat(128) },
      ],
    });
  });

  it.each([
    ['a jar outside the mods folder', 'overrides/config/hidden.jar', 'config/hidden.jar'],
    ['a zip in the mods folder', 'overrides/mods/old-style.zip', 'mods/old-style.zip'],
    ['a coremod', 'overrides/coremods/core.jar', 'coremods/core.jar'],
    ['one a client alone gets', 'client-overrides/mods/client.jar', 'mods/client.jar'],
    ['one in another case', 'overrides/mods/LOUD.JAR', 'mods/LOUD.JAR'],
  ])('lists %s', async (_what, entry, where) => {
    const result = await installer.importHandedOverMrpack(await packFile([], { [entry]: 'code' }));

    expect((reviewOf(result).unknown as Array<{ path: string }>).map((f) => f.path)).toEqual([
      where,
    ]);
  });

  it('holds a zip outside the mods folder to be no more than a zip', async () => {
    const result = await installer.importHandedOverMrpack(
      await packFile([], { 'overrides/resourcepacks/look.zip': 'pixels' }),
    );

    expect(result).toHaveProperty('profile');
  });

  it('leaves a file the index names to the index, which is the copy that stays', async () => {
    const result = await installer.importHandedOverMrpack(
      await packFile([indexed()], { 'overrides/mods/example.jar': 'whatever was left here' }),
    );

    expect(result).toHaveProperty('profile');
  });

  it('asks about a mirror list by the address that is used, which is the first', async () => {
    const result = await installer.importHandedOverMrpack(
      await packFile([
        indexed({ downloads: ['https://example.com/mod.jar', modrinthUrl('mod.jar')] }),
      ]),
    );

    expect(reviewOf(result).unknown).toHaveLength(1);
  });

  it('takes an address that only looks like Modrinth for what it is', async () => {
    const result = await installer.importHandedOverMrpack(
      await packFile([
        indexed({ downloads: ['https://cdn.modrinth.com.example.net/data/A/versions/B/mod.jar'] }),
      ]),
    );

    expect((reviewOf(result).unknown as Array<{ from: string }>)[0].from).toBe(
      'cdn.modrinth.com.example.net',
    );
  });

  it('lists a file with no sha512 without asking anybody, as there is nothing to ask with', async () => {
    const result = await installer.importHandedOverMrpack(
      await packFile([
        indexed({ hashes: { sha1: 'e'.repeat(40) }, downloads: ['https://example.com/mod.jar'] }),
      ]),
    );

    expect(reviewOf(result).unknown).toHaveLength(1);
    expect(modrinth.asked).toEqual([]);
  });

  it('lists everything, and says so, when Modrinth cannot be reached', async () => {
    modrinth.down = true;
    modrinth.known.add(sha512('published jar'));

    const result = await installer.importHandedOverMrpack(
      await packFile([], { 'overrides/mods/published.jar': 'published jar' }),
    );

    expect(reviewOf(result)).toMatchObject({ unchecked: true });
    expect(reviewOf(result).unknown).toHaveLength(1);
  });
});

describe('the answer', () => {
  it('installs what was accepted', async () => {
    const file = await packFile([], { 'overrides/mods/private.jar': 'private build' });

    const result = await installer.importHandedOverMrpack(file, [sha512('private build')]);

    expect(result).toHaveProperty('profile');
    expect(createProfile).toHaveBeenCalledTimes(1);
  });

  it('asks again about anything it did not name', async () => {
    const file = await packFile([], {
      'overrides/mods/private.jar': 'private build',
      'overrides/mods/another.jar': 'another build',
    });

    const result = await installer.importHandedOverMrpack(file, [sha512('private build')]);

    expect(createProfile).not.toHaveBeenCalled();
    expect(reviewOf(result).unknown).toHaveLength(2);
  });

  it('holds a link to what was seen: other bytes at the second asking are asked about', async () => {
    served = packBytes([], { 'overrides/mods/mod.jar': 'what was shown' });
    const first = await installer.createProfileFromUrl('https://example.com/pack');
    const accepted = (reviewOf(first).unknown as Array<{ key: string }>).map((f) => f.key);

    served = packBytes([], { 'overrides/mods/mod.jar': 'what comes instead' });
    const second = await installer.createProfileFromUrl('https://example.com/pack', accepted);

    expect(createProfile).not.toHaveBeenCalled();
    expect(reviewOf(second).unknown).toEqual([
      { path: 'mods/mod.jar', from: null, key: sha512('what comes instead') },
    ]);
  });

  it('holds a link to its word when it answers the same', async () => {
    served = packBytes([], { 'overrides/mods/mod.jar': 'what was shown' });
    const first = await installer.createProfileFromUrl('https://example.com/pack');
    const accepted = (reviewOf(first).unknown as Array<{ key: string }>).map((f) => f.key);

    expect(
      await installer.createProfileFromUrl('https://example.com/pack', accepted),
    ).toHaveProperty('profile');
  });
});

describe("a pack from the launcher's own search", () => {
  it('is not asked about', async () => {
    const file = packBytes([], { 'overrides/mods/bundled.jar': 'bundled' });
    served = file;

    const result = await installer.installModrinthPack({ id: 'P', name: 'Found' });

    expect(result).toHaveProperty('profile');
    expect(modrinth.asked).toEqual([]);
  });
});

describe('a manifest at an address the player pasted', () => {
  const MANIFEST_URL = 'https://example.com/manifest.json';

  const manifest = (mods: unknown[], over: Record<string, unknown> = {}) => ({
    manifestVersion: 2,
    serverName: 'A Server',
    minecraftVersion: '1.21.4',
    modLoader: 'fabric',
    mods,
    ...over,
  });
  const urlMod = (over: Record<string, unknown> = {}) => ({
    id: 'mod',
    name: 'A Mod',
    version: '1',
    source: 'url',
    url: 'https://example.com/mod.jar',
    fileName: 'mod.jar',
    sha512: 'f'.repeat(128),
    ...over,
  });

  /** A link holding this manifest, for both times it is fetched. */
  const serve = (body: unknown) => {
    served = Buffer.from(JSON.stringify(body));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(body))),
    );
  };

  it('asks about a mod from anywhere, and says it can change later', async () => {
    serve(manifest([urlMod()]));

    const result = await installer.createProfileFromUrl(MANIFEST_URL);

    expect(createProfile).not.toHaveBeenCalled();
    expect(reviewOf(result)).toEqual({
      name: 'A Server',
      unchecked: false,
      follows: true,
      unknown: [{ path: 'mods/mod.jar', from: 'example.com', key: 'f'.repeat(128) }],
    });
  });

  it('follows it once that was accepted', async () => {
    serve(manifest([urlMod()]));

    const result = await installer.createProfileFromUrl(MANIFEST_URL, ['f'.repeat(128)]);

    expect(result).toHaveProperty('profile');
    expect(createProfile.mock.calls[0]?.[0]).toMatchObject({ manifestUrl: MANIFEST_URL });
  });

  it('does not ask about what Modrinth serves or has published', async () => {
    modrinth.known.add('f'.repeat(128));
    serve(
      manifest([
        { id: 'a', name: 'A', version: '1', source: 'modrinth', projectId: 'AAAA' },
        urlMod({ id: 'b', url: modrinthUrl('b.jar'), sha512: undefined }),
        urlMod(),
      ]),
    );

    expect(await installer.createProfileFromUrl(MANIFEST_URL)).toHaveProperty('profile');
  });

  it('does not ask about a mod for the server alone', async () => {
    serve(manifest([urlMod({ side: 'server' })]));

    expect(await installer.createProfileFromUrl(MANIFEST_URL)).toHaveProperty('profile');
  });

  it('asks about a jar it fetches as a config file', async () => {
    serve(
      manifest([], {
        configFiles: [{ path: 'libraries/thing.jar', url: 'https://example.com/thing.jar' }],
      }),
    );

    const result = await installer.createProfileFromUrl(MANIFEST_URL);

    expect((reviewOf(result).unknown as Array<{ path: string }>).map((f) => f.path)).toEqual([
      'libraries/thing.jar',
    ]);
  });

  describe('signed', () => {
    const keys = nacl.sign.keyPair();
    const signed = (body: Record<string, unknown>, secretKey = keys.secretKey) => ({
      ...body,
      signature: encodeBase64(
        nacl.sign.detached(
          new TextEncoder().encode(canonicalize(body as unknown as SignedManifest)),
          secretKey,
        ),
      ),
    });
    const trust = () => {
      settings.trustedPublicKeys = [
        { name: 'Mine', publicKey: encodeBase64(keys.publicKey), addedAt: '2026-01-01T00:00:00Z' },
      ];
    };

    it('by a key the player trusts, is not asked about', async () => {
      trust();
      serve(signed(manifest([urlMod()])));

      expect(await installer.createProfileFromUrl(MANIFEST_URL)).toHaveProperty('profile');
      expect(modrinth.asked).toEqual([]);
    });

    it('by a key the player does not trust, is asked about like any other', async () => {
      serve(signed(manifest([urlMod()])));

      expect(reviewOf(await installer.createProfileFromUrl(MANIFEST_URL)).unknown).toHaveLength(1);
    });

    it('and then changed, is asked about', async () => {
      trust();
      const body = signed(manifest([]));
      serve({ ...body, mods: [urlMod()] });

      expect(reviewOf(await installer.createProfileFromUrl(MANIFEST_URL)).unknown).toHaveLength(1);
    });
  });

  it('stays out of the way of a page that is no manifest, which the sync will refuse', async () => {
    serve({ serverName: 'Nearly', minecraftVersion: '1.21.4', modLoader: 'fabric', mods: 'no' });

    expect(await installer.createProfileFromUrl(MANIFEST_URL)).toHaveProperty('profile');
  });
});

describe('the catalogue', () => {
  it('goes straight through, as its signature is checked by the sync', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              manifestVersion: 2,
              serverName: 'WR',
              minecraftVersion: '1.21.4',
              modLoader: 'fabric',
              mods: [],
            }),
          ),
      ),
    );

    const result = await installer.createProfileFromManifest('https://example.com/m.json');

    expect(result).toHaveProperty('profile');
    expect(modrinth.asked).toEqual([]);
  });
});
