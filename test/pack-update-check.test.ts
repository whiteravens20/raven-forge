import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ModManifest } from '../src/shared/manifest-schema';
import type { InstalledMod, Profile } from '../src/shared/ipc-types';

/**
 * The badge, end to end: read what the profile has, ask the pack what it ships,
 * write the answer where the UI reads it.
 *
 * `pack-diff.test.ts` proves the arithmetic. This proves it is wired to a real
 * sync-state file — the half that was missing, since the count was only ever
 * computed at the end of a sync and never on its own.
 */

let root: string;
const pushed: unknown[] = [];

const profile: Profile = {
  id: 'p1',
  name: 'White Ravens Classic',
  minecraftVersion: '26.2',
  modLoader: 'fabric',
  modLoaderVersion: '0.19.3',
  allocatedRamMb: 4096,
  createdAt: '2026-08-09T00:00:00.000Z',
  updatedAt: '2026-08-09T00:00:00.000Z',
  manifestUrl: 'https://example.test/manifest.json',
};

vi.mock('../src/main/window', () => ({
  getMainWindow: () => ({ webContents: { send: (_c: string, s: unknown) => pushed.push(s) } }),
}));
vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));
vi.mock('../src/core/config/settings-manager', () => ({
  getSettings: async () => ({ trustedPublicKeys: [], autoRemoveOrphanedMods: true }),
}));
vi.mock('../src/core/profiles/profile-manager', () => ({
  getProfile: async () => profile,
  getAllProfiles: async () => [profile],
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

const { checkForPackUpdates } = await import('../src/core/mods/mod-sync');

function manifest(mods: { id: string; version: string }[]): ModManifest {
  return {
    manifestVersion: 2,
    serverName: 'White Ravens Classic',
    minecraftVersion: '26.2',
    modLoader: 'fabric',
    modLoaderVersion: '0.19.3',
    mods: mods.map((m) => ({
      id: m.id,
      name: m.id,
      version: m.version,
      source: 'url',
      url: `https://example.test/${m.id}.jar`,
      fileName: `${m.id}-${m.version}.jar`,
      required: true,
      side: 'client',
    })),
    resourcePacks: [],
    shaders: [],
    configFiles: [],
  } as ModManifest;
}

const lock = (mods: { id: string; version: string }[]): InstalledMod[] =>
  mods.map(
    (m) =>
      ({
        id: m.id,
        name: m.id,
        version: m.version,
        source: 'url',
        fileName: `${m.id}-${m.version}.jar`,
        required: true,
        side: 'client',
        enabled: true,
        fromManifest: true,
      }) as InstalledMod,
  );

const readState = async () =>
  JSON.parse(await fs.readFile(path.join(root, 'sync-state.json'), 'utf-8'));

/** A profile that finished a sync and has been sitting there since. */
async function givenSyncedProfile(mods: { id: string; version: string }[]) {
  await fs.writeFile(path.join(root, 'installed.lock'), JSON.stringify(lock(mods)));
  await fs.writeFile(
    path.join(root, 'sync-state.json'),
    JSON.stringify({
      lastSyncedAt: '2026-08-04T07:39:36.785Z',
      manifestEtag: '"v1"',
      pendingUpdates: 0,
      status: 'synced',
      verification: { signed: true, valid: true },
    }),
  );
}

function serving(body: ModManifest | null, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(body ? JSON.stringify(body) : null, {
          status,
          headers: { etag: '"v2"' },
        }),
    ),
  );
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-pack-check-'));
  pushed.length = 0;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await fs.rm(root, { recursive: true, force: true });
});

describe('checkForPackUpdates', () => {
  it('turns a stale profile amber without installing anything', async () => {
    await givenSyncedProfile([{ id: 'jei', version: '30.16' }]);
    serving(
      manifest([
        { id: 'jei', version: '30.17' },
        { id: 'modonomicon', version: '2.4.0' },
      ]),
    );

    await checkForPackUpdates('p1');

    const state = await readState();
    expect(state.status).toBe('updates-available');
    expect(state.pendingUpdates).toBe(2);
    // The badge is told, rather than waiting to be asked again.
    expect(pushed).toHaveLength(1);
  });

  it('leaves a genuinely current profile alone', async () => {
    await givenSyncedProfile([{ id: 'jei', version: '30.17' }]);
    serving(manifest([{ id: 'jei', version: '30.17' }]));

    await checkForPackUpdates('p1');

    const state = await readState();
    expect(state.status).toBe('synced');
    expect(state.pendingUpdates).toBe(0);
  });

  it('keeps the ETag of the manifest the profile was reconciled against', async () => {
    // Storing the checked ETag would have the next real sync answer 304 and
    // reconcile against a manifest it never installed.
    await givenSyncedProfile([{ id: 'jei', version: '30.16' }]);
    serving(manifest([{ id: 'jei', version: '30.17' }]));

    await checkForPackUpdates('p1');

    expect((await readState()).manifestEtag).toBe('"v1"');
  });

  it('does not overwrite what the last sync said about the signature', async () => {
    await givenSyncedProfile([{ id: 'jei', version: '30.16' }]);
    serving(manifest([{ id: 'jei', version: '30.17' }]));

    await checkForPackUpdates('p1');

    expect((await readState()).verification).toEqual({ signed: true, valid: true });
  });

  it('says nothing about a profile that was never synced', async () => {
    serving(manifest([{ id: 'jei', version: '30.17' }]));

    await checkForPackUpdates('p1');

    await expect(fs.readFile(path.join(root, 'sync-state.json'), 'utf-8')).rejects.toThrow();
    expect(pushed).toHaveLength(0);
  });

  it('leaves a working profile untouched when the pack cannot be reached', async () => {
    // A check nobody asked for has no business turning a profile red.
    await givenSyncedProfile([{ id: 'jei', version: '30.16' }]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('getaddrinfo ENOTFOUND example.test');
      }),
    );

    await checkForPackUpdates('p1');

    const state = await readState();
    expect(state.status).toBe('synced');
    expect(state.errorMessage).toBeUndefined();
  });
});
