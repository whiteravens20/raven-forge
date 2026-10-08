// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/core/config/defaults';
import { REFUSED, madeUnreadable } from './helpers/unreadable';

/**
 * `settings.json`, and what happens when it is not what was expected.
 *
 * This file holds the theme, the feed URLs, the proxy and the trusted signing
 * keys, and every failure to read it used to be answered the same way: write
 * `DEFAULT_SETTINGS` over it. One unrecognised field — from a hand-edit, or
 * from a newer build's settings on a machine that got downgraded — destroyed
 * the lot, and the only trace was that everything had gone back to normal.
 *
 * The distinctions being pinned here are absent vs unreadable vs invalid. Only
 * the first of the three is an ordinary first launch.
 */

let root: string;

vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

async function loadModule() {
  vi.resetModules();
  const { reloadDataRoot } = await import('../src/core/config/data-root');
  reloadDataRoot();
  return import('../src/core/config/settings-manager');
}

const settingsFile = () => path.join(root, 'settings.json');

/** Root ignores the mode bits, so the unreadable-file case cannot be staged. */
const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-settings-'));
  process.env.RAVENFORGE_DATA_DIR = root;
});

afterEach(async () => {
  delete process.env.RAVENFORGE_DATA_DIR;
  await fs.rm(root, { recursive: true, force: true });
});

describe('loadSettings', () => {
  it('treats an absent file as a first launch and writes the defaults out', async () => {
    const { loadSettings } = await loadModule();
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(JSON.parse(await fs.readFile(settingsFile(), 'utf-8'))).toEqual(DEFAULT_SETTINGS);
  });

  it('reads back what was stored', async () => {
    await fs.writeFile(
      settingsFile(),
      JSON.stringify({ ...DEFAULT_SETTINGS, theme: 'light', downloadConcurrency: 3 }),
    );
    const { loadSettings } = await loadModule();
    const settings = await loadSettings();
    expect(settings.theme).toBe('light');
    expect(settings.downloadConcurrency).toBe(3);
  });

  it('keeps a copy of a file it could not make sense of, instead of deleting it', async () => {
    const broken = '{ "theme": "light", oops';
    await fs.writeFile(settingsFile(), broken);

    const { loadSettings } = await loadModule();
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);

    const kept = (await fs.readdir(root)).filter((f) => f.includes('.broken-'));
    expect(kept).toHaveLength(1);
    expect(await fs.readFile(path.join(root, kept[0]), 'utf-8')).toBe(broken);
  });

  it('does the same for a file that parses but is not settings', async () => {
    await fs.writeFile(settingsFile(), JSON.stringify({ downloadConcurrency: 'lots' }));
    const { loadSettings } = await loadModule();
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect((await fs.readdir(root)).some((f) => f.includes('.broken-'))).toBe(true);
  });

  it('keeps a stored trusted key the verifier cannot use, and the file with it', async () => {
    // Builds before the key check stored whatever was pasted into the form. Such
    // a key verifies nothing and still switches enforcement on; dropping it on
    // the way in would switch enforcement off with nobody having asked, and
    // refusing it would move the whole file aside.
    const cutShort = {
      name: 'Cut short',
      publicKey: 'MCowBQYDK2VwAyEA',
      addedAt: '2026-01-01T00:00:00.000Z',
    };
    await fs.writeFile(
      settingsFile(),
      JSON.stringify({ ...DEFAULT_SETTINGS, theme: 'light', trustedPublicKeys: [cutShort] }),
    );
    const { loadSettings } = await loadModule();
    const settings = await loadSettings();
    expect(settings.theme).toBe('light');
    expect(settings.trustedPublicKeys).toEqual([cutShort]);
    expect((await fs.readdir(root)).some((f) => f.includes('.broken-'))).toBe(false);
  });

  it.skipIf(asRoot)(
    'does not overwrite a file nobody could read',
    async () => {
      // Unreadable is not the same as absent. A permissions problem answered by
      // writing defaults is a permissions problem that eats the settings.
      await fs.writeFile(settingsFile(), JSON.stringify({ ...DEFAULT_SETTINGS, theme: 'light' }));
      const readable = await madeUnreadable(settingsFile());

      const { loadSettings } = await loadModule();
      expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);

      await readable();
      expect(JSON.parse(await fs.readFile(settingsFile(), 'utf-8')).theme).toBe('light');
    },
    30_000,
  );
});

describe('updateSettings', () => {
  it('changes one field and leaves the rest standing', async () => {
    const { loadSettings, updateSettings } = await loadModule();
    await loadSettings();
    const updated = await updateSettings({ theme: 'light' });
    expect(updated.theme).toBe('light');
    expect(updated.downloadConcurrency).toBe(DEFAULT_SETTINGS.downloadConcurrency);
    expect(JSON.parse(await fs.readFile(settingsFile(), 'utf-8')).theme).toBe('light');
  });

  it('refuses a value the schema does not accept', async () => {
    const { loadSettings, updateSettings } = await loadModule();
    await loadSettings();
    await expect(
      updateSettings({ downloadConcurrency: 9999 } as Partial<
        Awaited<ReturnType<typeof loadSettings>>
      >),
    ).rejects.toThrow();
  });

  it('leaves the file untouched when the update is refused', async () => {
    const { loadSettings, updateSettings } = await loadModule();
    await loadSettings();
    await updateSettings({ theme: 'light' }).catch(() => undefined);
    await expect(updateSettings({ theme: 'neon' } as never)).rejects.toThrow();
    expect(JSON.parse(await fs.readFile(settingsFile(), 'utf-8')).theme).toBe('light');
  });
});

describe('resetSettings', () => {
  it('puts the defaults back on disk and in the cache', async () => {
    const { loadSettings, updateSettings, resetSettings, getSettings } = await loadModule();
    await loadSettings();
    await updateSettings({ theme: 'light' });
    expect(await resetSettings()).toEqual(DEFAULT_SETTINGS);
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(JSON.parse(await fs.readFile(settingsFile(), 'utf-8'))).toEqual(DEFAULT_SETTINGS);
  });
});

/**
 * The launcher starts on the defaults when the file cannot be read, and those
 * defaults are a stand-in, not the settings.
 *
 * Nothing used to tell the two apart. The first change made after such a start
 * was merged into the defaults and saved — over the proxy, the trusted keys and
 * the theme in a file nobody had read, with no copy kept.
 */
describe.skipIf(asRoot)('after a start that could not read the file', () => {
  const real = {
    ...DEFAULT_SETTINGS,
    theme: 'light',
    proxyUrl: 'http://proxy.example.net:8080',
    trustedPublicKeys: [
      {
        name: 'Mine',
        publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        addedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  };

  /** A start with the file out of reach, and the way to put it back in reach. */
  async function startUnreadable() {
    await fs.writeFile(settingsFile(), JSON.stringify(real));
    const readable = await madeUnreadable(settingsFile());
    const mod = await loadModule();
    expect(await mod.loadSettings()).toEqual(DEFAULT_SETTINGS);
    return { ...mod, readable };
  }

  it('refuses a change instead of saving the defaults over the file', async () => {
    const { updateSettings, readable } = await startUnreadable();

    await expect(updateSettings({ showLiveConsole: true })).rejects.toThrow(REFUSED);

    await readable();
    expect(JSON.parse(await fs.readFile(settingsFile(), 'utf-8'))).toEqual(real);
  }, 30_000);

  it('refuses a reset for the same reason', async () => {
    const { resetSettings, readable } = await startUnreadable();

    await expect(resetSettings()).rejects.toThrow(REFUSED);

    await readable();
    expect(JSON.parse(await fs.readFile(settingsFile(), 'utf-8'))).toEqual(real);
  }, 30_000);

  it('builds the change on what the file holds once it can be read', async () => {
    const { updateSettings, getSettings, readable } = await startUnreadable();
    await readable();

    const updated = await updateSettings({ showLiveConsole: true });

    const expected = { ...real, showLiveConsole: true };
    expect(updated).toEqual(expected);
    expect(await getSettings()).toEqual(expected);
    expect(JSON.parse(await fs.readFile(settingsFile(), 'utf-8'))).toEqual(expected);
  });
});

describe('overlapping changes', () => {
  it('does not let two updates in flight lose each other', async () => {
    // Each one is a read, a merge and a write with an `await` in the middle.
    // Unqueued, they all merged into the same starting point, and whichever
    // finished last erased the rest — after each had been answered as saved.
    const { loadSettings, updateSettings, getSettings } = await loadModule();
    await loadSettings();

    const replies = await Promise.all([
      updateSettings({ theme: 'light' }),
      updateSettings({ downloadConcurrency: 2 }),
      updateSettings({ showLiveConsole: true }),
    ]);

    const all = { theme: 'light', downloadConcurrency: 2, showLiveConsole: true };
    expect(replies[2]).toMatchObject(all);
    expect(await getSettings()).toMatchObject(all);
    expect(JSON.parse(await fs.readFile(settingsFile(), 'utf-8'))).toMatchObject(all);
  });

  it('does not let an update made during a reset bring the old settings back', async () => {
    // The update merged into what was cached when it was called — the settings
    // the reset was in the middle of replacing — and then saved all of them.
    const { loadSettings, updateSettings, resetSettings, getSettings } = await loadModule();
    await loadSettings();
    await updateSettings({ theme: 'light' });

    await Promise.all([resetSettings(), updateSettings({ downloadConcurrency: 2 })]);

    const expected = { ...DEFAULT_SETTINGS, downloadConcurrency: 2 };
    expect(await getSettings()).toEqual(expected);
    expect(JSON.parse(await fs.readFile(settingsFile(), 'utf-8'))).toEqual(expected);
  });
});

describe('getSettings', () => {
  it('answers from the cache once loaded, without re-reading the file', async () => {
    const { getSettings } = await loadModule();
    await getSettings();
    await fs.writeFile(settingsFile(), '{ not json at all');
    // Still the cached value: this is what every `getSettings()` on the launch
    // path depends on, and it must not start failing because something else
    // corrupted the file mid-session.
    expect((await getSettings()).theme).toBe(DEFAULT_SETTINGS.theme);
  });
});
