// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { StorageEntry, StorageId } from '../src/shared/ipc-types';

/**
 * The list of places the launcher writes to, as the privacy page shows it.
 *
 * It replaced a sentence — "all of it sits in one folder" — that was true of a
 * default install and false of every other. What is pinned here is that the
 * list is read off the disk: what is there is listed with its real size, and
 * what the data's move changed is listed where it now is.
 */

let tmp: string;
let home: string;
let secrets: number | null = 4;

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) =>
      name === 'userData' ? home : name === 'exe' ? path.join(tmp, 'app', 'launcher') : tmp,
    getAppPath: () => path.join(tmp, 'app'),
    isPackaged: true,
  },
}));
vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));
vi.mock('../src/core/auth/secret-store', () => ({
  countSecrets: async () => secrets,
}));

type StorageMap = typeof import('../src/core/config/storage-map');
let mod: StorageMap;

async function load(): Promise<StorageMap> {
  vi.resetModules();
  const { reloadDataRoot } = await import('../src/core/config/data-root');
  reloadDataRoot();
  return import('../src/core/config/storage-map');
}

const byId = (entries: StorageEntry[]) =>
  Object.fromEntries(entries.map((entry) => [entry.id, entry])) as Partial<
    Record<StorageId, StorageEntry>
  >;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-storage-'));
  home = path.join(tmp, 'raven-forge-launcher');
  await fs.mkdir(home, { recursive: true });
  secrets = 4;
  process.env.XDG_CACHE_HOME = path.join(tmp, 'xdg-cache');
  delete process.env.APPIMAGE;
  mod = await load();
});

afterEach(async () => {
  delete process.env.XDG_CACHE_HOME;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('measureStorage', () => {
  it('lists the data folders with what is really in them', async () => {
    await fs.mkdir(path.join(home, 'profiles', 'p1', '.minecraft', 'saves'), { recursive: true });
    await fs.writeFile(
      path.join(home, 'profiles', 'p1', '.minecraft', 'saves', 'level.dat'),
      'x'.repeat(700),
    );
    await fs.writeFile(path.join(home, 'settings.json'), 'a'.repeat(10));
    await fs.writeFile(path.join(home, 'profiles.json'), 'b'.repeat(20));
    await fs.writeFile(path.join(home, 'auth.json'), 'c'.repeat(30));

    const report = await mod.measureStorage();
    const entries = byId(report.entries);

    expect(report.root).toBe(home);
    expect(entries.profiles).toMatchObject({ where: 'data', bytes: 700, openable: true });
    // The three state files are one line, sized together.
    expect(entries.state?.bytes).toBe(60);
    // Listed even though nothing is there yet: it is where things will appear.
    expect(entries.java).toMatchObject({ where: 'data', bytes: null });
  });

  it('leaves out a place outside the data folder that does not exist', async () => {
    const entries = byId((await mod.measureStorage()).entries);

    expect(entries.pointer).toBeUndefined();
    expect(entries.updateCache).toBeUndefined();
    expect(entries.legacyHome).toBeUndefined();
  });

  it('shows the pointer and the browser folder in the home once the data has moved', async () => {
    const elsewhere = path.join(tmp, 'games');
    await fs.mkdir(path.join(elsewhere, 'logs'), { recursive: true });
    await fs.writeFile(path.join(elsewhere, 'settings.json'), '{}');
    await fs.writeFile(path.join(elsewhere, 'logs', 'main.log'), 'l'.repeat(50));
    await fs.mkdir(path.join(home, 'browser'));
    await fs.writeFile(path.join(home, 'browser', 'Cookies'), 'k'.repeat(40));
    const { writeDataRootPointer } = await import('../src/core/config/data-root');
    await writeDataRootPointer(elsewhere);

    const report = await mod.measureStorage();
    const entries = byId(report.entries);

    expect(report.root).toBe(elsewhere);
    expect(report.home).toBe(home);
    // The log is with the data, not in the folder the data left.
    expect(entries.logs).toMatchObject({ where: 'data', bytes: 50 });
    expect(entries.logs?.path).toBe(path.join(elsewhere, 'logs'));
    expect(entries.browser).toMatchObject({ where: 'home', bytes: 40, openable: true });
    expect(entries.pointer?.where).toBe('home');
    expect(entries.pointer?.bytes).toBeGreaterThan(0);
  });

  it('lists what sits outside both folders, and will not offer to open it', async () => {
    const cache = path.join(tmp, 'xdg-cache', 'raven-forge-launcher-updater');
    await fs.mkdir(cache, { recursive: true });
    await fs.writeFile(path.join(cache, 'installer.exe'), 'i'.repeat(90));
    await fs.mkdir(path.join(tmp, 'app'));
    await fs.writeFile(path.join(tmp, 'app', 'launcher'), 'p'.repeat(15));
    await fs.mkdir(path.join(tmp, 'Raven Forge Launcher'));
    await fs.writeFile(path.join(tmp, 'Raven Forge Launcher', 'profiles.json'), '[]');

    const entries = byId((await mod.measureStorage()).entries);

    if (process.platform === 'linux') {
      expect(entries.updateCache).toMatchObject({ where: 'system', bytes: 90, openable: false });
    }
    expect(entries.program).toMatchObject({ where: 'system', bytes: 15, openable: false });
    expect(entries.legacyHome).toMatchObject({ where: 'system', bytes: 2, openable: false });
  });

  it('counts what the system keeps for the launcher, and says when it cannot ask', async () => {
    expect((await mod.measureStorage()).keychain.secrets).toBe(4);

    // No keyring service: not zero entries, but no answer — the sign-in is
    // then in a file, and the page has to say that instead.
    secrets = null;
    expect((await mod.measureStorage()).keychain.secrets).toBeNull();
  });
});
