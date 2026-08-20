import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { InstalledMod, Profile } from '../src/shared/ipc-types';

/**
 * The update check, over a real `mods/` directory and a real lock file.
 *
 * What it is here to pin down is the rule that makes the feature safe to run
 * unattended: an update is a *different file*, not a different version string,
 * and the check may only touch mods the launcher actually owns. Both are silent
 * when wrong — a profile that follows a pack would quietly drift away from its
 * server, and a project that relabels a build without republishing it would
 * offer the same "update" for ever.
 */

let root: string;

const profile: Profile = {
  id: 'p1',
  name: 'Hand-built',
  minecraftVersion: '1.21.4',
  modLoader: 'fabric',
  allocatedRamMb: 4096,
  createdAt: '2026-08-18T00:00:00.000Z',
  updatedAt: '2026-08-18T00:00:00.000Z',
};

/** hash → the newest build Modrinth would name for that file. */
const latest = new Map<string, unknown>();
const asked: Array<{ hashes: string[]; loaders: string[]; gameVersions: string[] }> = [];

vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));
vi.mock('../src/core/profiles/profile-manager', () => ({
  getProfile: async () => profile,
}));
vi.mock('../src/core/config/paths', () => ({
  paths: {
    profileModsDir: () => path.join(root, 'mods'),
    profileLockFile: () => path.join(root, 'installed.lock'),
  },
}));
// The install half is exercised by the app, not here; stubbing it keeps this
// test about the decision rather than about downloading.
vi.mock('../src/core/mods/mod-sync', () => ({
  downloadFor: () => ({ url: '', fileName: '', version: '', hashes: {} }),
  installResolvedMod: async () => ({}) as InstalledMod,
  installRequiredDependencies: async () => [],
}));
vi.mock('../src/core/mods/modrinth-api', () => ({
  latestVersionsByHash: async (hashes: string[], loaders: string[], gameVersions: string[]) => {
    asked.push({ hashes, loaders, gameVersions });
    return new Map(hashes.filter((h) => latest.has(h)).map((h) => [h, latest.get(h)]));
  },
  getVersion: async () => ({}),
  getProjectTitle: async () => 'Title',
  primaryFile: () => ({}),
}));

const { checkModUpdates } = await import('../src/core/mods/mod-updates');

function sha512(text: string): string {
  return crypto.createHash('sha512').update(text).digest('hex');
}

/** A Modrinth build, named by whichever file contents it ships. */
function build(id: string, versionNumber: string, contents: string) {
  return {
    id,
    project_id: `proj-${id}`,
    version_number: versionNumber,
    files: [{ hashes: { sha1: 'x', sha512: sha512(contents) }, primary: true }],
  };
}

function mod(over: Partial<InstalledMod> & { id: string; fileName: string }): InstalledMod {
  return {
    name: over.id,
    version: '1.0.0',
    source: 'modrinth',
    required: false,
    side: 'both',
    enabled: true,
    fromManifest: false,
    ...over,
  };
}

/** Write the lock file and the jars it names. */
async function profileWith(mods: InstalledMod[], contents: Record<string, string>): Promise<void> {
  await fs.mkdir(path.join(root, 'mods'), { recursive: true });
  for (const [file, body] of Object.entries(contents)) {
    await fs.writeFile(path.join(root, 'mods', file), body);
  }
  await fs.writeFile(path.join(root, 'installed.lock'), JSON.stringify(mods));
}

async function lockFile(): Promise<InstalledMod[]> {
  return JSON.parse(
    await fs.readFile(path.join(root, 'installed.lock'), 'utf-8'),
  ) as InstalledMod[];
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mod-updates-'));
  latest.clear();
  asked.length = 0;
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('checkModUpdates', () => {
  it('flags a mod whose newest build is a different file', async () => {
    await profileWith([mod({ id: 'sodium', fileName: 'sodium.jar' })], {
      'sodium.jar': 'old bytes',
    });
    latest.set(sha512('old bytes'), build('v2', '0.6.5', 'new bytes'));

    const summary = await checkModUpdates('p1');

    expect(summary).toEqual({ checked: 1, updates: 1, unknown: 0 });
    expect((await lockFile())[0].updateAvailable).toEqual({
      versionId: 'v2',
      versionNumber: '0.6.5',
      projectId: 'proj-v2',
    });
  });

  it('leaves a mod alone when the newest build is the file already installed', async () => {
    await profileWith([mod({ id: 'sodium', fileName: 'sodium.jar' })], {
      'sodium.jar': 'current bytes',
    });
    // Modrinth answers with a build whose *label* differs but whose file is the
    // one on disk — a relabelled release, which is not an update.
    latest.set(sha512('current bytes'), build('v9', '0.6.5+relabelled', 'current bytes'));

    const summary = await checkModUpdates('p1');

    expect(summary).toEqual({ checked: 1, updates: 0, unknown: 0 });
    expect((await lockFile())[0].updateAvailable).toBeUndefined();
  });

  it('never touches a mod the manifest owns, or one switched off', async () => {
    await profileWith(
      [
        mod({ id: 'pack-mod', fileName: 'pack.jar', fromManifest: true }),
        mod({ id: 'off-mod', fileName: 'off.jar', enabled: false }),
        mod({ id: 'mine', fileName: 'mine.jar' }),
      ],
      { 'pack.jar': 'a', 'off.jar.disabled': 'b', 'mine.jar': 'c' },
    );
    for (const body of ['a', 'b', 'c']) latest.set(sha512(body), build('v', '2.0', 'newer'));

    const summary = await checkModUpdates('p1');

    expect(summary.checked).toBe(1);
    expect(asked[0].hashes).toEqual([sha512('c')]);
    const after = await lockFile();
    expect(after.map((m) => Boolean(m.updateAvailable))).toEqual([false, false, true]);
  });

  it('narrows the question to what the profile could actually run', async () => {
    await profileWith([mod({ id: 'mine', fileName: 'mine.jar' })], { 'mine.jar': 'c' });

    await checkModUpdates('p1');

    expect(asked[0].loaders).toEqual(['fabric']);
    expect(asked[0].gameVersions).toEqual(['1.21.4']);
  });

  it('clears an offer that a later check no longer finds', async () => {
    await profileWith(
      [
        mod({
          id: 'sodium',
          fileName: 'sodium.jar',
          updateAvailable: { versionId: 'stale', versionNumber: '0.1', projectId: 'p' },
        }),
      ],
      { 'sodium.jar': 'current bytes' },
    );
    latest.set(sha512('current bytes'), build('v9', '0.6.5', 'current bytes'));

    await checkModUpdates('p1');

    expect((await lockFile())[0].updateAvailable).toBeUndefined();
  });

  it('counts a file Modrinth has never seen instead of failing over it', async () => {
    await profileWith(
      [
        mod({ id: 'private', fileName: 'private.jar', source: 'local' }),
        mod({ id: 'mine', fileName: 'mine.jar' }),
      ],
      { 'private.jar': 'nobody knows this', 'mine.jar': 'c' },
    );
    latest.set(sha512('c'), build('v2', '2.0', 'newer'));

    const summary = await checkModUpdates('p1');

    expect(summary).toEqual({ checked: 2, updates: 1, unknown: 1 });
  });

  it('skips a mod whose jar has gone missing rather than failing the check', async () => {
    await profileWith(
      [mod({ id: 'ghost', fileName: 'ghost.jar' }), mod({ id: 'mine', fileName: 'mine.jar' })],
      { 'mine.jar': 'c' },
    );
    latest.set(sha512('c'), build('v2', '2.0', 'newer'));

    const summary = await checkModUpdates('p1');

    expect(summary).toEqual({ checked: 1, updates: 1, unknown: 0 });
  });
});
