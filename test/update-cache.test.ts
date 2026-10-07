// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * What becomes of an update that was downloaded and never installed.
 *
 * The updater keeps a finished download until it installs it. A launcher that
 * was killed before it could, and whose player then installed the new version
 * by hand, left a whole installer in the cache — found by doing exactly that
 * with two released AppImages: 123 MB, still there after the new version had
 * started, checked for updates and been closed.
 */

const updater = vi.hoisted(() => ({ emitter: null as EventEmitter | null }));

vi.mock('electron-updater', () => ({
  get autoUpdater() {
    return updater.emitter;
  },
}));

vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

vi.mock('../src/main/window', () => ({ getMainWindow: () => null }));

let cache: string;
let before: string | undefined;

const pending = () => path.join(cache, 'raven-forge-launcher-updater', 'pending');
const installerCopy = () => path.join(cache, 'raven-forge-launcher-updater', 'installer.exe');

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(
    () => true,
    () => false,
  );
}

/** A download left behind: the installer and the note the updater keeps beside it. */
async function leaveDownload(): Promise<void> {
  await fs.mkdir(pending(), { recursive: true });
  await fs.writeFile(path.join(pending(), 'Raven-Forge-Launcher-0.7.1.AppImage'), 'an installer');
  await fs.writeFile(path.join(pending(), 'update-info.json'), '{}');
  await fs.writeFile(installerCopy(), 'what this install was made from');
}

beforeEach(async () => {
  cache = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-update-cache-'));
  before = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = cache;
  updater.emitter = new EventEmitter();
  vi.resetModules();
});

afterEach(async () => {
  if (before === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = before;
  await fs.rm(cache, { recursive: true, force: true });
});

describe.skipIf(process.platform !== 'linux')('a download nothing will install', () => {
  it('is cleared, and nothing beside it', async () => {
    const { clearPendingUpdate } = await import('../src/core/updater/update-cache');
    await leaveDownload();

    await clearPendingUpdate();

    expect(await exists(pending())).toBe(false);
    // What the next update is worked out against, on Windows.
    expect(await exists(installerCopy())).toBe(true);
  });

  it('is no error when there is none', async () => {
    const { clearPendingUpdate } = await import('../src/core/updater/update-cache');
    await expect(clearPendingUpdate()).resolves.toBeUndefined();
  });

  it('goes when a check finds nothing newer than what is running', async () => {
    const { initUpdater } = await import('../src/core/updater/launcher-updater');
    await leaveDownload();
    initUpdater();

    updater.emitter!.emit('update-not-available', { version: '0.7.1' });

    await vi.waitFor(async () => expect(await exists(pending())).toBe(false));
    expect(await exists(installerCopy())).toBe(true);
  });

  it('stays when this session fetched it and is waiting to install it', async () => {
    const { initUpdater } = await import('../src/core/updater/launcher-updater');
    await leaveDownload();
    initUpdater();

    updater.emitter!.emit('update-downloaded', { version: '0.7.2' });
    // A release withdrawn after it was fetched: the check no longer offers it.
    updater.emitter!.emit('update-not-available', { version: '0.7.1' });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(await exists(pending())).toBe(true);
  });

  it('stays while an update is on offer', async () => {
    const { initUpdater } = await import('../src/core/updater/launcher-updater');
    await leaveDownload();
    initUpdater();

    updater.emitter!.emit('update-available', { version: '0.7.2' });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(await exists(pending())).toBe(true);
  });
});
