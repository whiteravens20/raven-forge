// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ModManifest } from '../src/shared/manifest-schema';
import type { Profile } from '../src/shared/ipc-types';

/**
 * The copy of a pack's manifest a profile keeps, and the tag it is kept under.
 *
 * The two are one statement: "this is the manifest the profile was last brought
 * in line with, and the server called it this". A server that answers "not
 * modified" to the tag is answered with the copy, and with nothing to fetch the
 * copy is all there is. So they have to be written together, by a sync that
 * finished, and by nothing else.
 *
 * They were not. The copy was written the moment a manifest arrived — by a
 * check that installs nothing, and by a sync that then failed or was called
 * off — while the tag waited for a sync to finish. A profile that had only
 * *looked* at a new release held that release as its copy under the old one's
 * tag. Offline, it was then synced against a release it could not download,
 * and went red. And when a publisher took a release back, the server's "not
 * modified" for the old tag was answered with the release that had been
 * withdrawn: offered as an update, and installed by the next sync.
 *
 * Over a real socket, with a server that answers a conditional request the way
 * a static host does.
 */

let root: string;
let server: http.Server;
let base: string;
/** What the server has at each path. */
const served = new Map<string, string | number>();
/** Every request it answered, as `path → status`. */
const answered: string[] = [];

const profile: Profile = {
  id: 'p1',
  name: 'White Ravens Classic',
  minecraftVersion: '26.2',
  modLoader: 'fabric',
  modLoaderVersion: '0.19.3',
  allocatedRamMb: 4096,
  createdAt: '2026-10-08T00:00:00.000Z',
  updatedAt: '2026-10-08T00:00:00.000Z',
};

vi.mock('../src/main/window', () => ({ getMainWindow: () => null }));
vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));
vi.mock('../src/core/config/settings-manager', () => ({
  getSettings: async () => ({ trustedPublicKeys: [], downloadConcurrency: 2 }),
}));
vi.mock('../src/core/profiles/profile-manager', () => ({
  getProfile: async () => profile,
  getAllProfiles: async () => [profile],
  updateProfile: async () => profile,
}));
vi.mock('../src/core/mods/content-manager', () => ({ syncContentFromManifest: async () => {} }));
vi.mock('../src/core/config/paths', () => ({
  paths: {
    profileGameDir: () => path.join(root, 'game'),
    profileModsDir: () => path.join(root, 'game', 'mods'),
    profileLockFile: () => path.join(root, 'installed.lock'),
    profileSyncStateFile: () => path.join(root, 'sync-state.json'),
    profileManifestCacheFile: () => path.join(root, 'manifest.cache.json'),
  },
}));

const { syncManifest, checkForPackUpdates } = await import('../src/core/mods/mod-sync');

const sha256 = (body: string) => crypto.createHash('sha256').update(body).digest('hex');
/** The tag a static host gives a file: made of what the file holds. */
const tagOf = (body: string) => `"${sha256(body).slice(0, 12)}"`;

/** A release of the pack: one mod, at this version. */
function release(version: string): ModManifest {
  const fileName = `jei-${version}.jar`;
  const body = `jar of jei ${version}`;
  if (!served.has(`/mods/${fileName}`)) served.set(`/mods/${fileName}`, body);
  return {
    manifestVersion: 2,
    serverName: 'White Ravens Classic',
    minecraftVersion: '26.2',
    modLoader: 'fabric',
    modLoaderVersion: '0.19.3',
    mods: [
      {
        id: 'jei',
        name: 'JEI',
        version,
        source: 'url',
        url: `${base}/mods/${fileName}`,
        fileName,
        sha256: sha256(body),
        side: 'both',
      },
    ],
    resourcePacks: [],
    shaders: [],
    configFiles: [],
  } as ModManifest;
}

/** Put a release at the pack's address. */
const publish = (manifest: ModManifest) => served.set('/manifest.json', JSON.stringify(manifest));

const readJson = async (name: string) =>
  JSON.parse(await fs.readFile(path.join(root, name), 'utf-8'));
const state = () => readJson('sync-state.json');
const keptVersion = async () => (await readJson('manifest.cache.json')).mods[0].version as string;
const installed = async () => (await fs.readdir(path.join(root, 'game', 'mods'))).sort();

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-manifest-kept-'));
  served.clear();
  answered.length = 0;

  server = http.createServer((req, res) => {
    const answer = served.get(req.url ?? '');
    const say = (status: number) => {
      answered.push(`${req.url} → ${status}`);
      res.statusCode = status;
    };
    if (typeof answer !== 'string') {
      say(answer ?? 404);
      res.end('no');
      return;
    }
    res.setHeader('etag', tagOf(answer));
    if (req.headers['if-none-match'] === tagOf(answer)) {
      say(304);
      res.end();
      return;
    }
    say(200);
    res.end(answer);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || !address) throw new Error('no port');
  base = `http://127.0.0.1:${address.port}`;
  profile.manifestUrl = `${base}/manifest.json`;
});

afterEach(async () => {
  if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(root, { recursive: true, force: true });
});

describe('the manifest a profile keeps', () => {
  it('is the one a finished sync installed, under the tag it came with', async () => {
    const first = release('30.16');
    publish(first);

    await syncManifest('p1');

    expect(await keptVersion()).toBe('30.16');
    expect((await state()).manifestEtag).toBe(tagOf(JSON.stringify(first)));
  });

  it('is not replaced by a check, which installs nothing', async () => {
    publish(release('30.16'));
    await syncManifest('p1');

    publish(release('30.17'));
    await checkForPackUpdates('p1');

    expect((await state()).status).toBe('updates-available');
    // What the profile has is still 30.16, and so is what it holds a copy of.
    expect(await keptVersion()).toBe('30.16');
    expect(await installed()).toEqual(['jei-30.16.jar']);
  });

  it('is not replaced by a sync that does not finish', async () => {
    const first = release('30.16');
    publish(first);
    await syncManifest('p1');

    publish(release('30.17'));
    served.set('/mods/jei-30.17.jar', 503);
    await expect(syncManifest('p1')).rejects.toThrow(/503/);

    expect(await keptVersion()).toBe('30.16');
    expect((await state()).manifestEtag).toBe(tagOf(JSON.stringify(first)));
  });
});

describe('a release that is taken back', () => {
  it('is not offered, and not installed, once the server is back on the one the profile has', async () => {
    publish(release('30.16'));
    await syncManifest('p1');

    // Released, seen by a launcher that was open at the time, and withdrawn.
    publish(release('30.17'));
    await checkForPackUpdates('p1');
    publish(release('30.16'));
    answered.length = 0;

    await checkForPackUpdates('p1');
    expect(await state()).toMatchObject({ status: 'synced', pendingUpdates: 0 });

    await syncManifest('p1');
    expect(await installed()).toEqual(['jei-30.16.jar']);
    // Asked twice whether the manifest had moved, told twice that it had not,
    // and never sent for the build that was withdrawn.
    expect(answered).toEqual(['/manifest.json → 304', '/manifest.json → 304']);
  });

  it('is not what a sync falls back on when the first try at it failed', async () => {
    publish(release('30.16'));
    await syncManifest('p1');

    publish(release('30.17'));
    served.set('/mods/jei-30.17.jar', 503);
    await expect(syncManifest('p1')).rejects.toThrow(/503/);
    publish(release('30.16'));

    await syncManifest('p1');

    expect(await installed()).toEqual(['jei-30.16.jar']);
    expect(await state()).toMatchObject({ status: 'synced', pendingUpdates: 0 });
  });
});

describe('with no network', () => {
  it('a profile that had only seen a new release is still in step with the one it has', async () => {
    publish(release('30.16'));
    await syncManifest('p1');
    publish(release('30.17'));
    await checkForPackUpdates('p1');

    // The laptop is closed, carried somewhere, and opened with no connection.
    await new Promise<void>((resolve) => server.close(() => resolve()));

    await syncManifest('p1');

    expect(await installed()).toEqual(['jei-30.16.jar']);
    expect((await state()).status).toBe('synced');
  });
});
