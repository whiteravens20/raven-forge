// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ModManifest } from '../src/shared/manifest-schema';
import type { Profile } from '../src/shared/ipc-types';

/**
 * What a pack sync and a mod update leave in `mods/`.
 *
 * Each case here is a way the list said one thing and the folder held another:
 * a jar deleted by the update that had just downloaded it, a first install
 * fetched again in full because one file failed, a file removed out from under
 * the entry that had taken it over. All of them resolved without an error, so
 * they are run against real files.
 */

let root: string;
let profile: Profile;

/** What each URL serves; a URL mapped to `null` fails. */
const published = new Map<string, string | null>();
/** Every URL asked for, in order. */
const fetched: string[] = [];
/** Runs before each download — the hook a test uses to act in the middle of a sync. */
let beforeDownload: (url: string) => void | Promise<void> = () => {};
/** Runs once a download is on disk, with the path it was written to. */
let afterDownload: (dest: string) => Promise<void> = async () => {};

vi.mock('../src/main/window', () => ({ getMainWindow: () => null }));
vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));
vi.mock('../src/core/config/settings-manager', () => ({
  getSettings: async () => ({ trustedPublicKeys: [], downloadConcurrency: 1 }),
}));
const updateProfile = vi.fn(async (_id: string, updates: Partial<Profile>) => {
  profile = { ...profile, ...updates };
  return profile;
});
vi.mock('../src/core/profiles/profile-manager', () => ({
  getProfile: async () => profile,
  updateProfile: (id: string, updates: Partial<Profile>) => updateProfile(id, updates),
}));
vi.mock('../src/core/mods/content-manager', () => ({ syncContentFromManifest: async () => {} }));
vi.mock('../src/core/net/download', () => ({
  downloadToFile: async (url: string, dest: string) => {
    await beforeDownload(url);
    fetched.push(url);
    const body = published.get(url);
    if (body === null || body === undefined) throw new Error(`503 for ${url}`);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, body);
    await afterDownload(dest);
  },
}));
/** What Modrinth lists for a project, by project id. */
const modrinthBuilds = new Map<string, unknown[]>();
vi.mock('../src/core/mods/modrinth-api', async (original) => ({
  ...(await original<typeof import('../src/core/mods/modrinth-api')>()),
  getModVersions: async (projectId: string) => modrinthBuilds.get(projectId) ?? [],
}));
vi.mock('../src/core/config/paths', () => ({
  paths: {
    profileGameDir: () => path.join(root, 'game'),
    profileModsDir: () => path.join(root, 'game', 'mods'),
    profileLockFile: () => path.join(root, 'installed.lock'),
    profileSyncStateFile: () => path.join(root, 'sync-state.json'),
    profileManifestCacheFile: () => path.join(root, 'manifest.cache.json'),
  },
}));

const { syncManifest, installResolvedMod, toggleModEnabled, getProfileSyncStatus } =
  await import('../src/core/mods/mod-sync');
const { readLockFile } = await import('../src/core/mods/lock-file');
const { pendingChanges } = await import('../src/core/mods/pack-diff');
const { cancelJob, isCancellation } = await import('../src/core/util/cancellation');

const sha256 = (body: string) => crypto.createHash('sha256').update(body).digest('hex');
const urlOf = (file: string) => `https://example.test/mods/${file}`;

/** One pack mod: `id` served as `file` (default `<id>.jar`) with `body`. */
function mod(id: string, opts: { file?: string; body?: string } = {}) {
  const fileName = opts.file ?? `${id}.jar`;
  const body = opts.body ?? `jar of ${id}`;
  published.set(urlOf(fileName), body);
  return {
    id,
    name: id,
    version: '1.0.0',
    source: 'url' as const,
    url: urlOf(fileName),
    fileName,
    sha256: sha256(body),
    required: true,
    side: 'both' as const,
  };
}

function pack(mods: ReturnType<typeof mod>[], extra: Partial<ModManifest> = {}): ModManifest {
  return {
    manifestVersion: 2,
    serverName: 'White Ravens Forge',
    minecraftVersion: '1.21.1',
    modLoader: 'neoforge',
    modLoaderVersion: '21.1.209',
    mods,
    resourcePacks: [],
    shaders: [],
    configFiles: [],
    ...extra,
  } as ModManifest;
}

const modsDir = () => path.join(root, 'game', 'mods');
const jars = async () => (await fs.readdir(modsDir())).sort();
const lock = () => readLockFile('p1');

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-sync-files-'));
  await fs.mkdir(modsDir(), { recursive: true });
  published.clear();
  modrinthBuilds.clear();
  fetched.length = 0;
  beforeDownload = () => {};
  afterDownload = async () => {};
  updateProfile.mockClear();
  profile = {
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
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('a first install that fails part-way', () => {
  it('does not fetch again what already arrived', async () => {
    const first = mod('jei');
    const broken = mod('mekanism');
    const last = mod('waystones');
    published.set(broken.url, null);

    await expect(syncManifest('p1', pack([first, broken, last]))).rejects.toThrow(/503/);
    expect(await jars()).toEqual(['jei.jar']);

    // The retry: the broken file is back, and only it and what came after it
    // are fetched. Nothing was recorded by the failed run, so the file on disk
    // matching the manifest's hash is the only thing that says it is there.
    published.set(broken.url, 'jar of mekanism');
    fetched.length = 0;
    await syncManifest('p1', pack([first, broken, last]));

    expect(fetched).toEqual([broken.url, last.url]);
    expect(await jars()).toEqual(['jei.jar', 'mekanism.jar', 'waystones.jar']);
    expect((await lock()).map((m) => m.id)).toEqual(['jei', 'mekanism', 'waystones']);
  });

  it('does not take a file that merely has the right name', async () => {
    const jei = mod('jei');
    await fs.writeFile(path.join(modsDir(), 'jei.jar'), 'something else entirely');

    await syncManifest('p1', pack([jei]));

    expect(fetched).toEqual([jei.url]);
    expect(await fs.readFile(path.join(modsDir(), 'jei.jar'), 'utf-8')).toBe('jar of jei');
  });
});

describe('a pack that renames an entry and keeps its file', () => {
  it('leaves the file with the entry that now owns it', async () => {
    await syncManifest('p1', pack([mod('old-id', { file: 'shared.jar', body: 'the jar' })]));

    // Same jar, same name, new id: the old id is dropped and the new one added.
    await syncManifest('p1', pack([mod('new-id', { file: 'shared.jar', body: 'the jar' })]));

    expect(await jars()).toEqual(['shared.jar']);
    expect((await lock()).map((m) => m.id)).toEqual(['new-id']);
  });
});

describe('cancelling a sync', () => {
  it('is reported to the caller, so a launch does not carry on after it', async () => {
    const jei = mod('jei');
    const mekanism = mod('mekanism');
    beforeDownload = (url) => {
      if (url === mekanism.url) cancelJob('p1');
    };

    const outcome = await syncManifest('p1', pack([jei, mekanism])).catch((err: unknown) => err);

    // Returning normally here is what let the game start on half an update.
    expect(isCancellation(outcome)).toBe(true);
    // And the profile is left as it was, not flagged as failed.
    expect((await getProfileSyncStatus('p1')).status).toBe('never-synced');
  });
});

describe('a mod switched off while its pack is syncing', () => {
  /** Switch JEI off at the moment the sync starts fetching `trigger`. */
  const switchOffDuring = (trigger: { url: string }) => {
    beforeDownload = async (url) => {
      if (url === trigger.url) await toggleModEnabled('p1', 'jei', false);
    };
  };

  it('stays off, and is not fetched again beside the file that was switched off', async () => {
    const jei = mod('jei');
    const mekanism = mod('mekanism');
    await syncManifest('p1', pack([jei]));

    switchOffDuring(mekanism);
    await syncManifest('p1', pack([jei, mekanism]));

    // The list was rewritten from what the sync had read before the downloads,
    // so the mod came out of it marked on, with its file under the other name.
    expect(await jars()).toEqual(['jei.jar.disabled', 'mekanism.jar']);
    expect((await lock()).find((m) => m.id === 'jei')?.enabled).toBe(false);

    beforeDownload = () => {};
    fetched.length = 0;
    await syncManifest('p1', pack([jei, mekanism]));

    expect(fetched).toEqual([]);
    expect(await jars()).toEqual(['jei.jar.disabled', 'mekanism.jar']);
  });

  it('stays off when the same sync brings a new build of it', async () => {
    await syncManifest('p1', pack([mod('jei', { file: 'jei-1.jar', body: 'build one' })]));

    const mekanism = mod('mekanism');
    switchOffDuring(mekanism);
    await syncManifest(
      'p1',
      pack([mekanism, mod('jei', { file: 'jei-2.jar', body: 'build two' })]),
    );

    // One file, the new build, under the name its state implies.
    expect(await jars()).toEqual(['jei-2.jar.disabled', 'mekanism.jar']);
    expect((await lock()).find((m) => m.id === 'jei')?.enabled).toBe(false);
  });
});

describe('updating a mod installed by hand', () => {
  const install = (file: string, body: string, version: string) => {
    published.set(urlOf(file), body);
    return installResolvedMod(
      'p1',
      { id: 'moonlight', name: 'Moonlight Lib', source: 'modrinth' },
      { url: urlOf(file), fileName: file, version, hashes: { sha256: sha256(body) } },
    );
  };

  it('keeps the new build when the author reused the file name', async () => {
    await install('moonlight.jar', 'build one', '1.0.0');
    await install('moonlight.jar', 'build two', '2.0.0');

    // Deleting "the file this replaces" by name used to delete this one.
    expect(await jars()).toEqual(['moonlight.jar']);
    expect(await fs.readFile(path.join(modsDir(), 'moonlight.jar'), 'utf-8')).toBe('build two');
    expect((await lock())[0].version).toBe('2.0.0');
  });

  it('removes the old file when the name changed', async () => {
    await install('moonlight-1.jar', 'build one', '1.0.0');
    await install('moonlight-2.jar', 'build two', '2.0.0');

    expect(await jars()).toEqual(['moonlight-2.jar']);
  });

  it('leaves a mod the player switched off switched off, with one file', async () => {
    await install('moonlight-1.jar', 'build one', '1.0.0');
    await toggleModEnabled('p1', 'moonlight', false);

    await install('moonlight-2.jar', 'build two', '2.0.0');

    expect(await jars()).toEqual(['moonlight-2.jar.disabled']);
    expect((await lock())[0].enabled).toBe(false);
  });
});

describe('a file that has just been downloaded', () => {
  // The downloader hashes the bytes as it writes them, so there is nothing left
  // to read the file for. Making it unreadable the moment it lands is how that
  // is seen from here — which only means anything where a mode bit can stop a
  // read at all.
  const readsCannotBeRefused = process.platform === 'win32' || process.getuid?.() === 0;
  const makeUnreadable = (dest: string) => fs.chmod(dest, 0o000);

  it.skipIf(readsCannotBeRefused)('is not read back from disk by a pack sync', async () => {
    afterDownload = makeUnreadable;

    // Every jar used to be read again from start to finish, for a sha256 that
    // nothing in the launcher ever looked at.
    await syncManifest('p1', pack([mod('jei'), mod('mekanism')]));

    expect((await lock()).map((m) => m.id)).toEqual(['jei', 'mekanism']);
  });

  it.skipIf(readsCannotBeRefused)('is not read back by an install from the browser', async () => {
    afterDownload = makeUnreadable;
    published.set(urlOf('moonlight.jar'), 'build one');

    await installResolvedMod(
      'p1',
      { id: 'moonlight', name: 'Moonlight Lib', source: 'modrinth' },
      {
        url: urlOf('moonlight.jar'),
        fileName: 'moonlight.jar',
        version: '1.0.0',
        hashes: { sha256: sha256('build one') },
      },
    );

    expect((await lock()).map((m) => m.id)).toEqual(['moonlight']);
  });
});

describe('a pack that moves to a newer loader build', () => {
  /** Serve `manifest` at the profile's manifest address. */
  const publish = (manifest: ModManifest) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(manifest), { status: 200 })),
    );

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('takes the profile with it', async () => {
    // The build was copied when the profile was made and never again, so a pack
    // that needed a newer one delivered its mods to a loader that could not
    // run them.
    publish(pack([mod('jei')], { modLoaderVersion: '21.1.250' }));

    await syncManifest('p1');

    expect(updateProfile).toHaveBeenCalledWith('p1', { modLoaderVersion: '21.1.250' });
    expect(profile.modLoaderVersion).toBe('21.1.250');
  });

  it('leaves the profile alone when the build has not moved', async () => {
    publish(pack([mod('jei')]));

    await syncManifest('p1');

    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('does not switch the profile to a different loader', async () => {
    // A different loader is a different game directory in all but name; that
    // one is for a person to decide.
    publish(pack([mod('jei')], { modLoader: 'fabric', modLoaderVersion: '0.17.2' }));

    await syncManifest('p1');

    expect(updateProfile).not.toHaveBeenCalled();
    expect(profile.modLoader).toBe('neoforge');
  });

  it('does not let an imported pack file move the profile it was installed into', async () => {
    // A supplied manifest is the import itself, which has just set the build.
    await syncManifest('p1', pack([mod('jei')], { modLoaderVersion: '21.1.250' }));

    expect(updateProfile).not.toHaveBeenCalled();
  });
});

describe('a pack that names a Modrinth build by its id', () => {
  it('is level with the pack once it has synced', async () => {
    // The lock recorded Modrinth's version number, and what is compared with
    // the manifest is the manifest's own label — so an entry pinned by id read
    // as out of date the moment the sync that installed it had finished, and
    // stayed that way through every sync after.
    const body = 'jar of sodium 0.6.5';
    published.set(urlOf('sodium-0.6.5.jar'), body);
    modrinthBuilds.set('AANobbMI', [
      {
        id: 'pinnedId',
        version_number: '0.6.5',
        files: [
          {
            url: urlOf('sodium-0.6.5.jar'),
            filename: 'sodium-0.6.5.jar',
            hashes: { sha512: crypto.createHash('sha512').update(body).digest('hex'), sha1: '' },
            primary: true,
            size: body.length,
          },
        ],
      },
    ]);
    const manifest = pack([
      {
        id: 'sodium',
        name: 'Sodium',
        version: 'pinnedId',
        source: 'modrinth',
        projectId: 'AANobbMI',
        required: true,
        side: 'both',
      } as unknown as ReturnType<typeof mod>,
    ]);

    await syncManifest('p1', manifest);

    expect(await jars()).toEqual(['sodium-0.6.5.jar']);
    expect((await lock())[0].version).toBe('pinnedId');
    expect(pendingChanges(manifest.mods, await lock())).toBe(0);
  });
});
