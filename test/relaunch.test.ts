// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The launcher restarting itself — after a move of the data, above all.
 *
 * From an AppImage it used to close and stay closed. Electron leaves a restart
 * to a helper that is a second copy of the running program, and in an AppImage
 * that program lives in a mount which is taken down when the launcher leaves,
 * helper and all. What is held here is which of the two ways a restart goes,
 * and in what order: seen for real, on the AppImage the packaging job builds.
 */

const { did, spawned } = vi.hoisted(() => ({
  /** What was asked of Electron, in the order it was asked. */
  did: [] as string[],
  spawned: [] as Array<{ file: string; args: string[]; options: unknown; unref: boolean }>,
}));

vi.mock('electron', () => ({
  app: {
    relaunch: () => did.push('relaunch'),
    quit: () => did.push('quit'),
    releaseSingleInstanceLock: () => did.push('release the lock'),
  },
}));

vi.mock('node:child_process', () => ({
  spawn: (file: string, args: string[], options: unknown) => {
    const started = { file, args, options, unref: false };
    spawned.push(started);
    did.push('start the file');
    return {
      unref: () => {
        started.unref = true;
      },
    };
  },
}));

const { relaunchLauncher } = await import('../src/main/relaunch');

const argv = process.argv;

beforeEach(() => {
  did.length = 0;
  spawned.length = 0;
});

afterEach(() => {
  delete process.env.APPIMAGE;
  process.argv = argv;
});

describe('restarting the launcher', () => {
  it('is left to Electron wherever the program is a file that stays where it is', () => {
    relaunchLauncher();

    expect(did).toEqual(['relaunch', 'quit']);
    expect(spawned).toEqual([]);
  });

  it('starts the AppImage file itself, as it was started, and lets go of it', () => {
    process.env.APPIMAGE = '/home/player/Raven-Forge-Launcher-1.0.0.AppImage';
    process.argv = ['/tmp/.mount_RavenAbCdEf/raven-forge-launcher', '--no-sandbox'];

    relaunchLauncher();

    expect(spawned).toEqual([
      {
        file: '/home/player/Raven-Forge-Launcher-1.0.0.AppImage',
        // Not the program inside the mount, which is what `argv[0]` names.
        args: ['--no-sandbox'],
        options: { detached: true, stdio: 'ignore' },
        unref: true,
      },
    ]);
  });

  it('gives up the one-instance lock before the new one is started, and leaves after', () => {
    // Started while this one still held it, the new launcher would take itself
    // for a second copy and close — and then this one closes too.
    process.env.APPIMAGE = '/home/player/Raven-Forge-Launcher-1.0.0.AppImage';

    relaunchLauncher();

    expect(did).toEqual(['release the lock', 'start the file', 'quit']);
  });
});
