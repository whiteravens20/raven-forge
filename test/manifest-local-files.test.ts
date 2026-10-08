// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ModManifest } from '../src/shared/manifest-schema';
import type { Profile } from '../src/shared/ipc-types';

/**
 * A manifest entry that names a file on the player's own computer.
 *
 * `source: "local"` has a mod copied in from a path instead of fetched. It is
 * for somebody building a pack: the manifest is served from their own machine,
 * and the jar they are working on is on the same disk. A manifest from anywhere
 * else has no business knowing what is on this one — such an entry had the
 * launcher copy any file it could read into `mods/`, and on Windows a path
 * beginning `\\host\` sent it to that host to ask for it, at the sync, before
 * the player had started anything.
 *
 * So it is read from a manifest this computer served, and refuses the whole
 * manifest from any other.
 */

let root: string;
let server: http.Server;
let base: string;
let manifestBody: string;

const profile: Profile = {
  id: 'p1',
  name: 'A pack in the making',
  minecraftVersion: '1.21.1',
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

const { syncManifest } = await import('../src/core/mods/mod-sync');

/** A manifest whose one mod is a file at `localPath`. */
function naming(localPath: string): ModManifest {
  return {
    manifestVersion: 2,
    serverName: 'A pack in the making',
    minecraftVersion: '1.21.1',
    modLoader: 'fabric',
    modLoaderVersion: '0.19.3',
    mods: [
      { id: 'mine', name: 'My mod', version: 'dev', source: 'local', localPath, side: 'client' },
    ],
    resourcePacks: [],
    shaders: [],
    configFiles: [],
  } as ModManifest;
}

const installed = async () =>
  (await fs.readdir(path.join(root, 'game', 'mods')).catch(() => [])).sort();

/** Have the manifest arrive from `asked`, having been answered by `answeredBy`. */
function arrivingFrom(asked: string, answeredBy = asked): void {
  profile.manifestUrl = asked;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const res = new Response(manifestBody, { status: 200 });
      Object.defineProperty(res, 'url', { value: answeredBy });
      return res;
    }),
  );
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-manifest-local-'));
  await fs.writeFile(path.join(root, 'my-mod.jar'), 'a jar being worked on');
  manifestBody = JSON.stringify(naming(path.join(root, 'my-mod.jar')));

  server = http.createServer((_req, res) => res.end(manifestBody));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || !address) throw new Error('no port');
  base = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(root, { recursive: true, force: true });
});

describe('a file on this computer, named by a manifest', () => {
  it('is copied in when the manifest was served by this computer', async () => {
    profile.manifestUrl = `${base}/manifest.json`;

    await syncManifest('p1');

    expect(await installed()).toEqual(['my-mod.jar']);
    expect(await fs.readFile(path.join(root, 'game', 'mods', 'my-mod.jar'), 'utf-8')).toBe(
      'a jar being worked on',
    );
  });

  it('refuses the whole manifest when that came from anywhere else', async () => {
    arrivingFrom('https://packs.example/manifest.json');

    await expect(syncManifest('p1')).rejects.toThrow(/names a file on this computer/);
    expect(await installed()).toEqual([]);
    // And is not kept, to be gone back to when there is no network.
    await expect(fs.stat(path.join(root, 'manifest.cache.json'))).rejects.toThrow();
  });

  it('refuses it whatever the path is — a share on another machine as well', async () => {
    manifestBody = JSON.stringify(naming('\\\\files.example\\share\\mod.jar'));
    arrivingFrom('https://packs.example/manifest.json');

    await expect(syncManifest('p1')).rejects.toThrow(/names a file on this computer/);
  });

  it('refuses it when an address elsewhere was answered by this computer', async () => {
    // A redirect to something that listens here and can be made to say what it
    // is told is not this computer's own manifest.
    arrivingFrom('https://packs.example/manifest.json', `${base}/manifest.json`);

    await expect(syncManifest('p1')).rejects.toThrow(/names a file on this computer/);
    expect(await installed()).toEqual([]);
  });

  it('refuses it when an address on this computer was answered from elsewhere', async () => {
    arrivingFrom(`${base}/manifest.json`, 'https://packs.example/manifest.json');

    await expect(syncManifest('p1')).rejects.toThrow(/names a file on this computer/);
    expect(await installed()).toEqual([]);
  });

  it('refuses a copy of such a manifest kept from before, when the network is gone', async () => {
    profile.manifestUrl = 'https://packs.example/manifest.json';
    await fs.writeFile(path.join(root, 'manifest.cache.json'), manifestBody);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );

    await expect(syncManifest('p1')).rejects.toThrow(/names a file on this computer/);
    expect(await installed()).toEqual([]);
  });

  it('leaves a manifest from elsewhere that names no such file exactly as it was', async () => {
    manifestBody = JSON.stringify({ ...naming('unused'), mods: [] });
    arrivingFrom('https://packs.example/manifest.json');

    await expect(syncManifest('p1')).resolves.toBeUndefined();
  });
});
