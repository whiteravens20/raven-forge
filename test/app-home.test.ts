// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  carryDiagnostics,
  fileBrowserDataAway,
  isDirectoryInUse,
  resolveAppHome,
} from '../src/core/config/app-home';

/**
 * Where the launcher lives, and the one-time move there from the old name.
 *
 * This is the code that renames the directory holding somebody's worlds, at
 * startup, without asking. Every case below is either "it must happen exactly
 * once and lose nothing" or "it must not happen at all right now".
 */

let appData: string;
const home = () => path.join(appData, 'raven-forge-launcher');
const legacy = () => path.join(appData, 'Raven Forge Launcher');

/** What an install up to 0.7.1 left: its data and Chromium's files, side by side. */
function seedLegacy(dir = legacy()): void {
  fs.mkdirSync(path.join(dir, 'profiles', 'p1', '.minecraft', 'saves', 'World'), {
    recursive: true,
  });
  fs.writeFileSync(path.join(dir, 'profiles.json'), '[{"id":"p1"}]');
  fs.writeFileSync(path.join(dir, 'settings.json'), '{"theme":"dark"}');
  fs.writeFileSync(path.join(dir, 'auth.json'), '{}');
  fs.mkdirSync(path.join(dir, 'logs'));
  fs.writeFileSync(path.join(dir, 'logs', 'main.log'), 'old log');
  fs.writeFileSync(path.join(dir, '.updaterId'), 'abc');
  // Chromium's.
  fs.mkdirSync(path.join(dir, 'Local Storage'));
  fs.writeFileSync(path.join(dir, 'Local Storage', 'leveldb'), 'dismissed announcements');
  fs.mkdirSync(path.join(dir, 'Cache'));
  fs.writeFileSync(path.join(dir, 'Cookies'), 'sign-in');
  fs.writeFileSync(path.join(dir, 'Preferences'), '{}');
}

const world = (dir: string) => path.join(dir, 'profiles', 'p1', '.minecraft', 'saves', 'World');

beforeEach(() => {
  appData = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-app-home-'));
});

afterEach(() => {
  fs.rmSync(appData, { recursive: true, force: true });
});

describe('resolveAppHome', () => {
  it('is a folder with no spaces in its name on a fresh install', () => {
    const result = resolveAppHome(appData, undefined, process.platform);

    expect(result.dir).toBe(home());
    expect(path.basename(result.dir)).not.toContain(' ');
    expect(result.browserDir).toBe(path.join(home(), 'browser'));
    expect(result.migratedFrom).toBeUndefined();
    // Deciding where it is does not create it.
    expect(fs.existsSync(home())).toBe(false);
  });

  it('renames the old-named folder into place, once, with everything in it', () => {
    seedLegacy();

    const first = resolveAppHome(appData, undefined, process.platform);

    expect(first.dir).toBe(home());
    expect(first.migratedFrom).toBe(legacy());
    expect(fs.existsSync(legacy())).toBe(false);
    expect(fs.existsSync(world(home()))).toBe(true);
    expect(fs.readFileSync(path.join(home(), 'Cookies'), 'utf-8')).toBe('sign-in');

    // The second start finds it done.
    const second = resolveAppHome(appData, undefined, process.platform);
    expect(second.dir).toBe(home());
    expect(second.migratedFrom).toBeUndefined();
  });

  it('leaves an old-named folder alone when the new one is already there', () => {
    // Somebody ran the older build again after updating. That folder is not
    // merged into anything; it is simply not the home.
    seedLegacy();
    fs.mkdirSync(home());
    fs.writeFileSync(path.join(home(), 'settings.json'), '{"theme":"light"}');

    const result = resolveAppHome(appData, undefined, process.platform);

    expect(result.dir).toBe(home());
    expect(fs.existsSync(world(legacy()))).toBe(true);
    expect(fs.readFileSync(path.join(home(), 'settings.json'), 'utf-8')).toBe('{"theme":"light"}');
  });

  it('uses the old folder exactly as it stands when it cannot be renamed', () => {
    // A file where the new folder would go stands in for whatever makes the
    // rename fail — on Windows, anything at all holding a file open inside.
    seedLegacy();
    fs.writeFileSync(home(), 'in the way');

    const result = resolveAppHome(appData, undefined, process.platform);

    expect(result.dir).toBe(legacy());
    expect(result.legacyInUse).toBe(legacy());
    // Nothing rearranged: the browser's files stay where the older build —
    // which may be the thing running in there — expects them.
    expect(result.browserDir).toBe(legacy());
    expect(fs.existsSync(world(legacy()))).toBe(true);
  });

  it.skipIf(process.platform === 'win32')(
    'does not rename a folder another copy of the launcher is running in',
    () => {
      seedLegacy();
      // Chromium's lock: a link naming the host and the pid that holds it. The
      // test runner's parent is as good a live process as any.
      fs.symlinkSync(`${os.hostname()}-${process.ppid}`, path.join(legacy(), 'SingletonLock'));

      const result = resolveAppHome(appData, undefined, process.platform);

      expect(result.dir).toBe(legacy());
      expect(result.legacyInUse).toBe(legacy());
      expect(fs.existsSync(home())).toBe(false);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'is not put off by a lock whose owner is long gone',
    () => {
      seedLegacy();
      fs.symlinkSync(`${os.hostname()}-2147483646`, path.join(legacy(), 'SingletonLock'));

      expect(resolveAppHome(appData, undefined, process.platform).migratedFrom).toBe(legacy());
    },
  );

  it('makes the environment’s folder the home as well as the data', () => {
    // A portable install: with only the data sent there, the log, the crash
    // reports and the whole browser profile were still written to the host.
    seedLegacy();
    const stick = path.join(appData, 'stick', 'raven');

    const result = resolveAppHome(appData, stick, process.platform);

    expect(result.dir).toBe(stick);
    expect(result.browserDir).toBe(path.join(stick, 'browser'));
    expect(fs.statSync(stick).isDirectory()).toBe(true);
    // And the installed copy's folder is none of its business.
    expect(fs.existsSync(world(legacy()))).toBe(true);
  });

  it('ignores an environment value that is not an absolute path', () => {
    expect(resolveAppHome(appData, 'relative/dir', process.platform).dir).toBe(home());
  });
});

describe('isDirectoryInUse', () => {
  let child: ChildProcess | undefined;

  afterEach(() => {
    child?.kill('SIGKILL');
    child = undefined;
  });

  it.skipIf(process.platform !== 'linux')(
    'sees a game still running out of a profile',
    async () => {
      seedLegacy();
      const gameDir = path.join(legacy(), 'profiles', 'p1', '.minecraft');
      // What a game left running by an earlier session looks like from here: a
      // process whose working directory is the profile.
      child = spawn('sleep', ['30'], { cwd: gameDir, stdio: 'ignore' });
      await new Promise((resolve) => child!.once('spawn', resolve));

      expect(isDirectoryInUse(legacy(), 'linux')).toBe(true);
      // Renamed underneath it, it would go on saving to a path that no longer
      // exists — so the rename waits for another start.
      expect(resolveAppHome(appData, undefined, 'linux').legacyInUse).toBe(legacy());
    },
  );

  it('finds nothing in a folder nobody is using', () => {
    seedLegacy();
    expect(isDirectoryInUse(legacy(), process.platform)).toBe(false);
  });

  it('leaves the question to the rename itself on Windows', () => {
    // Windows refuses to rename a directory with anything open beneath it, so
    // there is nothing to ask first.
    seedLegacy();
    fs.symlinkSync(`${os.hostname()}-${process.ppid}`, path.join(legacy(), 'SingletonLock'));
    expect(isDirectoryInUse(legacy(), 'win32')).toBe(false);
  });
});

describe('fileBrowserDataAway', () => {
  it('moves everything that is not the launcher’s into the browser folder', () => {
    seedLegacy();
    const result = resolveAppHome(appData, undefined, process.platform);

    fileBrowserDataAway(result);

    // The launcher's own, where they were.
    expect(fs.readdirSync(home()).sort()).toEqual([
      '.updaterId',
      'auth.json',
      'browser',
      'logs',
      'profiles',
      'profiles.json',
      'settings.json',
    ]);
    // Chromium's, moved and not thrown away: what it remembered is still there.
    expect(fs.readdirSync(path.join(home(), 'browser')).sort()).toEqual([
      'Cache',
      'Cookies',
      'Local Storage',
      'Preferences',
    ]);
    expect(fs.readFileSync(path.join(home(), 'browser', 'Local Storage', 'leveldb'), 'utf-8')).toBe(
      'dismissed announcements',
    );
  });

  it('keeps a state file that was set aside, and one caught mid-write', () => {
    seedLegacy();
    fs.writeFileSync(path.join(legacy(), 'settings.json.broken-1700000000000'), '{');
    fs.writeFileSync(path.join(legacy(), 'profiles.json.4242.a1b2c3.tmp'), '[');
    const result = resolveAppHome(appData, undefined, process.platform);

    fileBrowserDataAway(result);

    expect(fs.existsSync(path.join(home(), 'settings.json.broken-1700000000000'))).toBe(true);
    expect(fs.existsSync(path.join(home(), 'profiles.json.4242.a1b2c3.tmp'))).toBe(true);
  });

  it('does it once, and leaves later arrivals alone', () => {
    seedLegacy();
    const result = resolveAppHome(appData, undefined, process.platform);
    fileBrowserDataAway(result);

    // Electron puts its single-instance lock at the top of the home on every
    // start; a sweep that ran each time would carry it off from under itself.
    fs.writeFileSync(path.join(home(), 'lockfile'), '');
    fileBrowserDataAway(result);

    expect(fs.existsSync(path.join(home(), 'lockfile'))).toBe(true);
  });

  it('touches nothing in a folder being used as the older build left it', () => {
    seedLegacy();
    fs.writeFileSync(home(), 'in the way');
    const result = resolveAppHome(appData, undefined, process.platform);

    fileBrowserDataAway(result);

    expect(fs.existsSync(path.join(legacy(), 'Cookies'))).toBe(true);
    expect(fs.existsSync(path.join(legacy(), 'browser'))).toBe(false);
  });

  it('just makes the folder on a fresh install', () => {
    fs.mkdirSync(home());
    fileBrowserDataAway({ dir: home(), browserDir: path.join(home(), 'browser') });
    expect(fs.readdirSync(home())).toEqual(['browser']);
  });
});

describe('carryDiagnostics', () => {
  it('brings the log and the crash reports to data that had already moved', () => {
    // The data went to another drive under an older build, which kept these
    // two in the home whatever the data did.
    const root = path.join(appData, 'games');
    fs.mkdirSync(path.join(home(), 'logs'), { recursive: true });
    fs.writeFileSync(path.join(home(), 'logs', 'main.log'), 'history');
    fs.mkdirSync(path.join(home(), 'crash-reports'));
    fs.writeFileSync(path.join(home(), 'crash-reports', 'crash-a.txt'), 'report');
    fs.mkdirSync(root);

    carryDiagnostics(home(), root);

    expect(fs.readFileSync(path.join(root, 'logs', 'main.log'), 'utf-8')).toBe('history');
    expect(fs.readFileSync(path.join(root, 'crash-reports', 'crash-a.txt'), 'utf-8')).toBe(
      'report',
    );
    // And the home no longer has a folder for the "open logs" button to be
    // wrong about.
    expect(fs.existsSync(path.join(home(), 'logs'))).toBe(false);
    expect(fs.existsSync(path.join(home(), 'crash-reports'))).toBe(false);
  });

  it('keeps both when a file of that name is already there', () => {
    const root = path.join(appData, 'games');
    fs.mkdirSync(path.join(home(), 'logs'), { recursive: true });
    fs.writeFileSync(path.join(home(), 'logs', 'main.log'), 'older');
    fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'logs', 'main.log'), 'newer');

    carryDiagnostics(home(), root);

    expect(fs.readFileSync(path.join(root, 'logs', 'main.log'), 'utf-8')).toBe('newer');
    expect(fs.readFileSync(path.join(root, 'logs', 'earlier-main.log'), 'utf-8')).toBe('older');
  });

  it('has nothing to do while the data is still in the home', () => {
    fs.mkdirSync(path.join(home(), 'logs'), { recursive: true });
    fs.writeFileSync(path.join(home(), 'logs', 'main.log'), 'log');

    carryDiagnostics(home(), home());

    expect(fs.readFileSync(path.join(home(), 'logs', 'main.log'), 'utf-8')).toBe('log');
  });
});
