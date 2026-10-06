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
 * A pack sync over a real socket, with the real downloader.
 *
 * The other sync tests hand it a stand-in that writes a file and returns, which
 * is right for what they are about and cannot see any of this: what is on disk
 * while a file is still on its way, and what is left when it never arrives.
 */

let root: string;
let server: http.Server;
let base: string;
/** What each path answers with. A number is a status, and no body worth having. */
const served = new Map<string, string | number>();
/** How long the server sits on each request before answering. */
let delayMs = 0;
/** The most requests it has been answering at once. */
let peak = 0;
/** The "concurrent downloads" setting. */
let downloadConcurrency = 4;

const profile: Profile = {
  id: 'p1',
  name: 'White Ravens Forge',
  minecraftVersion: '1.21.1',
  modLoader: 'neoforge',
  modLoaderVersion: '21.1.209',
  allocatedRamMb: 4096,
  createdAt: '2026-10-05T00:00:00.000Z',
  updatedAt: '2026-10-05T00:00:00.000Z',
  manifestUrl: 'https://example.test/manifest.json',
};

vi.mock('../src/main/window', () => ({ getMainWindow: () => null }));
vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));
vi.mock('../src/core/config/settings-manager', () => ({
  getSettings: async () => ({ trustedPublicKeys: [], downloadConcurrency }),
}));
vi.mock('../src/core/profiles/profile-manager', () => ({ getProfile: async () => profile }));
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
const { readLockFile } = await import('../src/core/mods/lock-file');

const sha256 = (body: string) => crypto.createHash('sha256').update(body).digest('hex');

/** One pack mod, served as `file` with `body`. */
function mod(id: string, opts: { file?: string; body?: string; version?: string } = {}) {
  const fileName = opts.file ?? `${id}.jar`;
  const body = opts.body ?? `jar of ${id}`;
  served.set(`/mods/${fileName}`, body);
  return {
    id,
    name: id,
    version: opts.version ?? '1.0.0',
    source: 'url' as const,
    url: `${base}/mods/${fileName}`,
    fileName,
    sha256: sha256(body),
    side: 'both' as const,
  };
}

/** One config override, served with `body`. */
function config(file: string, body: string) {
  served.set(`/configs/${file}`, body);
  return { path: file, url: `${base}/configs/${file}`, sha256: sha256(body) };
}

function pack(contents: {
  mods?: ReturnType<typeof mod>[];
  configs?: ReturnType<typeof config>[];
}): ModManifest {
  return {
    manifestVersion: 2,
    serverName: 'White Ravens Forge',
    minecraftVersion: '1.21.1',
    modLoader: 'neoforge',
    modLoaderVersion: '21.1.209',
    mods: contents.mods ?? [],
    resourcePacks: [],
    shaders: [],
    configFiles: contents.configs ?? [],
  } as ModManifest;
}

const modsDir = () => path.join(root, 'game', 'mods');
const gameFile = (name: string) => fs.readFile(path.join(root, 'game', name), 'utf-8');

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-sync-downloads-'));
  await fs.mkdir(modsDir(), { recursive: true });
  served.clear();
  delayMs = 0;
  peak = 0;
  downloadConcurrency = 4;

  let answering = 0;
  server = http.createServer((req, res) => {
    peak = Math.max(peak, ++answering);
    setTimeout(() => {
      answering--;
      const answer = served.get(req.url ?? '');
      if (typeof answer !== 'string') {
        res.statusCode = answer ?? 404;
        res.end('no');
        return;
      }
      res.end(answer);
    }, delayMs);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || !address) throw new Error('no port');
  base = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(root, { recursive: true, force: true });
});

describe('a pack with many mods', () => {
  const ids = ['ae2', 'create', 'jei', 'mekanism', 'sodium', 'waystones'];

  it('fetches them several at a time, as the downloads setting says', async () => {
    downloadConcurrency = 3;
    delayMs = 40;

    await syncManifest('p1', pack({ mods: ids.map((id) => mod(id)) }));

    // One after another, whatever the setting, is how it used to go.
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(3);
    expect((await fs.readdir(modsDir())).sort()).toEqual(ids.map((id) => `${id}.jar`));
    // Recorded in the pack's order, not in the order the files happened to land.
    expect((await readLockFile('p1')).map((m) => m.id)).toEqual(ids);
  });

  it('fetches one at a time when that is what was asked for', async () => {
    downloadConcurrency = 1;
    delayMs = 5;

    await syncManifest('p1', pack({ mods: ids.map((id) => mod(id)) }));

    expect(peak).toBe(1);
  });

  it('keeps what arrived when one of them fails, and stops there', async () => {
    downloadConcurrency = 2;
    const mods = ids.map((id) => mod(id));
    served.set('/mods/create.jar', 503);

    await expect(syncManifest('p1', pack({ mods }))).rejects.toThrow(/503/);

    // Nothing is recorded by a sync that failed; the files that landed are
    // found again by their hashes, and only the rest is fetched.
    expect(await readLockFile('p1')).toEqual([]);
    const landed = await fs.readdir(modsDir());
    expect(landed).not.toContain('create.jar');
    expect(landed.every((name) => name.endsWith('.jar'))).toBe(true);
  });
});

describe('a file that fails to arrive', () => {
  it('leaves the player their own copy of a config the pack could not deliver', async () => {
    await syncManifest('p1', pack({ configs: [config('options.txt', 'fov:80\n')] }));
    // The game rewrites this file on exit; by now it is the player's.
    await fs.writeFile(path.join(root, 'game', 'options.txt'), 'fov:110\n');

    // The pack ships a new version of it, and its host is having a bad day.
    const next = config('options.txt', 'fov:80\nsimulationDistance:8\n');
    served.set('/configs/options.txt', 503);

    await expect(syncManifest('p1', pack({ configs: [next] }))).rejects.toThrow(/503/);
    expect(await gameFile('options.txt')).toBe('fov:110\n');
  });

  it('leaves it too when what arrived is not the file the pack described', async () => {
    await syncManifest('p1', pack({ configs: [config('options.txt', 'fov:80\n')] }));
    await fs.writeFile(path.join(root, 'game', 'options.txt'), 'fov:110\n');

    const next = config('options.txt', 'fov:80\nsimulationDistance:8\n');
    served.set('/configs/options.txt', 'not what the manifest hashed');

    await expect(syncManifest('p1', pack({ configs: [next] }))).rejects.toThrow(/mismatch/);
    expect(await gameFile('options.txt')).toBe('fov:110\n');
  });

  it('keeps the build of a mod already installed when its replacement does not arrive', async () => {
    await syncManifest('p1', pack({ mods: [mod('moonlight', { body: 'build one' })] }));

    // Republished under the name it had, which is the file the old build is in.
    const next = mod('moonlight', { body: 'build two', version: '2.0.0' });
    served.set('/mods/moonlight.jar', 503);

    await expect(syncManifest('p1', pack({ mods: [next] }))).rejects.toThrow(/503/);
    expect(await gameFile('mods/moonlight.jar')).toBe('build one');
  });
});
