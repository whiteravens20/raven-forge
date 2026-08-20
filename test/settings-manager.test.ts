import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/core/config/defaults';

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

  it.skipIf(asRoot)('does not overwrite a file nobody could read', async () => {
    // Unreadable is not the same as absent. A permissions problem answered by
    // writing defaults is a permissions problem that eats the settings.
    await fs.writeFile(settingsFile(), JSON.stringify({ ...DEFAULT_SETTINGS, theme: 'light' }));
    await fs.chmod(settingsFile(), 0o000);

    const { loadSettings } = await loadModule();
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);

    await fs.chmod(settingsFile(), 0o600);
    expect(JSON.parse(await fs.readFile(settingsFile(), 'utf-8')).theme).toBe('light');
  });
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
