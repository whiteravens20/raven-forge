// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import realFs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The movable data directory.
 *
 * The cases here are the ones where being wrong costs somebody their profiles:
 * a move that stops half-way and leaves the data in two places, a copy that
 * loses the 0600 on `auth.json`, a pointer at an unplugged drive answered by
 * silently starting empty, a half-finished target mistaken for a folder used
 * before, and a folder full of somebody's other files that the launcher's data
 * is poured into — and that the uninstaller would then delete whole.
 */

let userData: string;
let launching = false;
let jobs = false;
/** Paths under this directory answer as a different volume. */
let otherVolume: string | null = null;
/** Free bytes reported for every volume, when a test wants to say. */
let freeBytes: number | null = null;
/** Makes `copyFile` fail for a destination containing this text. */
let failCopyAt: string | null = null;
/** Makes `rm` fail for a path containing this text. */
let failRemoveAt: string | null = null;

vi.mock('electron', () => ({
  app: { getPath: () => userData },
}));
vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));
vi.mock('../src/core/minecraft/game-launcher', () => ({
  isLaunchInProgress: () => launching,
}));
vi.mock('../src/core/util/cancellation', () => ({
  hasActiveJobs: () => jobs,
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const onOther = (p: unknown) => otherVolume !== null && String(p).startsWith(otherVolume);

  const stat = async (p: Parameters<typeof actual.stat>[0]) => {
    const real = await actual.stat(p);
    if (!onOther(p)) return real;
    // The same answer, from a different device.
    return Object.assign(Object.create(Object.getPrototypeOf(real) as object), real, {
      dev: real.dev + 1,
    }) as typeof real;
  };
  const rename = async (from: string, to: string) => {
    if (onOther(from) !== onOther(to)) {
      const err = new Error('cross-device link not permitted') as NodeJS.ErrnoException;
      err.code = 'EXDEV';
      throw err;
    }
    return actual.rename(from, to);
  };
  const statfs = async (p: string) => {
    const real = await actual.statfs(p);
    return freeBytes === null ? real : { ...real, bavail: freeBytes, bsize: 1 };
  };
  const copyFile = async (from: string, to: string) => {
    if (failCopyAt !== null && to.includes(failCopyAt)) throw new Error('disk full');
    return actual.copyFile(from, to);
  };
  const rm = async (p: string, options?: Parameters<typeof actual.rm>[1]) => {
    if (failRemoveAt !== null && p.includes(failRemoveAt)) {
      const err = new Error('resource busy or locked') as NodeJS.ErrnoException;
      err.code = 'EBUSY';
      throw err;
    }
    return actual.rm(p, options);
  };
  const patched = { ...actual, stat, rename, statfs, copyFile, rm };
  return { ...patched, default: patched };
});

const {
  dataRoot,
  dataRootSource,
  dataRootUnavailable,
  reloadDataRoot,
  writeDataRootPointer,
  dataRootPointerFile,
  decodePointer,
  DATA_DIR_ENV,
} = await import('../src/core/config/data-root');
const { planDataRootChange, applyDataRoot, movableSize, recoverInterruptedMove, pathConcerns } =
  await import('../src/core/config/data-root-move');
const { paths } = await import('../src/core/config/paths');

let tmp: string;

async function seedLauncherData(root: string) {
  await realFs.mkdir(path.join(root, 'profiles', 'p1', '.minecraft', 'mods'), { recursive: true });
  await realFs.writeFile(path.join(root, 'profiles.json'), '[{"id":"p1"}]');
  await realFs.writeFile(path.join(root, 'settings.json'), '{"theme":"dark"}');
  await realFs.writeFile(path.join(root, 'auth.json'), '{"accounts":[]}', { mode: 0o600 });
  await realFs.writeFile(
    path.join(root, 'profiles', 'p1', '.minecraft', 'mods', 'a.jar'),
    'x'.repeat(64),
  );
  await realFs.mkdir(path.join(root, 'java', 'jre-25'), { recursive: true });
  await realFs.writeFile(path.join(root, 'java', 'jre-25', 'bin'), 'y'.repeat(32));
  await realFs.mkdir(path.join(root, 'logs'), { recursive: true });
  await realFs.writeFile(path.join(root, 'logs', 'main.log'), 'log');
  await realFs.mkdir(path.join(root, 'crash-reports'), { recursive: true });
}

/** What the home keeps for itself: the embedded browser's files. */
async function seedBrowserState(root: string) {
  await realFs.mkdir(path.join(root, 'browser', 'Local Storage'), { recursive: true });
  await realFs.writeFile(path.join(root, 'browser', 'Cookies'), 'chromium');
  await realFs.writeFile(path.join(root, 'browser', 'Local Storage', 'leveldb'), 'chromium');
}

/** What a launcher leaves in a folder it only stood in for an unplugged drive. */
async function seedStandIn(root: string) {
  await realFs.mkdir(root, { recursive: true });
  await realFs.writeFile(path.join(root, 'settings.json'), '{"theme":"light"}');
  for (const dir of ['profiles', 'loaders', 'java', 'cache']) {
    await realFs.mkdir(path.join(root, dir), { recursive: true });
  }
}

const exists = (p: string) =>
  realFs
    .lstat(p)
    .then(() => true)
    .catch(() => false);
const list = async (dir: string) => (await realFs.readdir(dir)).sort();

/** Another drive, mounted at `<tmp>/usb`. Returns a folder on it. */
async function plugIn(): Promise<string> {
  otherVolume = path.join(tmp, 'usb');
  await realFs.mkdir(otherVolume, { recursive: true });
  return path.join(otherVolume, 'games');
}

beforeEach(async () => {
  tmp = await realFs.mkdtemp(path.join(os.tmpdir(), 'rf-data-root-'));
  userData = path.join(tmp, 'userData');
  await realFs.mkdir(userData, { recursive: true });
  launching = false;
  jobs = false;
  otherVolume = null;
  freeBytes = null;
  failCopyAt = null;
  failRemoveAt = null;
  delete process.env[DATA_DIR_ENV];
  reloadDataRoot();
});

afterEach(async () => {
  delete process.env[DATA_DIR_ENV];
  reloadDataRoot();
  await realFs.rm(tmp, { recursive: true, force: true });
});

describe('resolving the root', () => {
  it('is the home when nothing says otherwise', () => {
    expect(dataRoot()).toBe(userData);
    expect(dataRootSource()).toBe('default');
  });

  it('follows a pointer, and forgets it again when it is cleared', async () => {
    const elsewhere = path.join(tmp, 'games');
    await seedLauncherData(elsewhere);
    await writeDataRootPointer(elsewhere);
    expect(dataRoot()).toBe(elsewhere);
    expect(dataRootSource()).toBe('pointer');

    await writeDataRootPointer(null);
    expect(dataRoot()).toBe(userData);
    expect(await exists(dataRootPointerFile())).toBe(false);
  });

  /**
   * The file has a second reader with no JSON parser and no forgiveness:
   * `build/installer.nsh` follows it to make good on Windows' "delete my data".
   * It reads with `FileReadUTF16LE`, because the plain `FileRead` decodes in
   * the machine's ANSI code page — and a UTF-8 path with a Polish letter in it
   * then named a folder that does not exist.
   */
  it('writes the pointer as the one UTF-16 line the uninstaller reads', async () => {
    const elsewhere = path.join(tmp, 'Gry', 'Świat');
    await seedLauncherData(elsewhere);
    await writeDataRootPointer(elsewhere);

    const raw = await realFs.readFile(dataRootPointerFile());
    expect([...raw.subarray(0, 2)]).toEqual([0xff, 0xfe]);
    expect(raw.subarray(2).toString('utf16le')).toBe(`${elsewhere}\r\n`);
    // And the launcher reads its own writing back, letter for letter.
    reloadDataRoot();
    expect(dataRoot()).toBe(elsewhere);
  });

  it('still reads a pointer an older build wrote as UTF-8', async () => {
    const elsewhere = path.join(tmp, 'games');
    await seedLauncherData(elsewhere);
    await realFs.writeFile(dataRootPointerFile(), `${elsewhere}\n`, 'utf-8');
    reloadDataRoot();

    expect(dataRoot()).toBe(elsewhere);
    expect(decodePointer(Buffer.from('  /somewhere/else \n'))).toBe('/somewhere/else');
    // And leaves it in the form the uninstaller can follow.
    const raw = await realFs.readFile(dataRootPointerFile());
    expect([...raw.subarray(0, 2)]).toEqual([0xff, 0xfe]);
    expect(decodePointer(raw)).toBe(elsewhere);
  });

  it('ignores a pointer that is not an absolute path', async () => {
    await realFs.writeFile(dataRootPointerFile(), 'games\n');
    reloadDataRoot();
    expect(dataRoot()).toBe(userData);
    expect(dataRootSource()).toBe('default');
  });

  it('writes no pointer for the default path, so the state survives being copied', async () => {
    await writeDataRootPointer(userData);
    expect(await exists(dataRootPointerFile())).toBe(false);
    expect(dataRootSource()).toBe('default');
  });

  it('stands in for an unreachable root, and says which one', async () => {
    const unplugged = path.join(tmp, 'external', 'games');
    await seedLauncherData(unplugged);
    await writeDataRootPointer(unplugged);
    await realFs.rm(path.join(tmp, 'external'), { recursive: true, force: true });
    reloadDataRoot();

    expect(dataRoot()).toBe(userData);
    expect(dataRootSource()).toBe('default');
    expect(dataRootUnavailable()).toBe(unplugged);
  });

  it('does not take an empty folder where the data should be for the data', async () => {
    // What an unplugged drive often leaves: its mount point, as an empty
    // directory. Taken for the root, the launcher started with no profiles and
    // wrote a fresh set of its files onto the wrong disk.
    const mountPoint = path.join(tmp, 'mnt', 'games');
    await seedLauncherData(mountPoint);
    await writeDataRootPointer(mountPoint);
    await realFs.rm(mountPoint, { recursive: true, force: true });
    await realFs.mkdir(mountPoint);
    reloadDataRoot();

    expect(dataRoot()).toBe(userData);
    expect(dataRootUnavailable()).toBe(mountPoint);
  });

  it('lets the environment outrank a pointer', async () => {
    const pointed = path.join(tmp, 'pointed');
    const forced = path.join(tmp, 'forced');
    await seedLauncherData(pointed);
    await writeDataRootPointer(pointed);
    process.env[DATA_DIR_ENV] = forced;
    reloadDataRoot();

    expect(dataRoot()).toBe(forced);
    expect(dataRootSource()).toBe('env');
    // Created rather than refused: a portable install starts with an empty stick.
    expect(await exists(forced)).toBe(true);
  });
});

describe('planning a change', () => {
  beforeEach(() => seedLauncherData(userData));

  it('refuses the directory already in use', async () => {
    expect((await planDataRootChange(userData)).problem).toBe('same');
  });

  it('refuses a directory inside the current one', async () => {
    expect((await planDataRootChange(path.join(userData, 'profiles', 'elsewhere'))).problem).toBe(
      'nested',
    );
  });

  it('refuses while a game is running or being got ready', async () => {
    launching = true;
    expect((await planDataRootChange(path.join(tmp, 'games'))).problem).toBe('gameRunning');
  });

  it('refuses while a download is under way', async () => {
    // A pack sync writes into the directories that are about to be carried
    // off; what it creates after the move has listed its files would be
    // deleted with the originals.
    jobs = true;
    expect((await planDataRootChange(path.join(tmp, 'games'))).problem).toBe('gameRunning');
  });

  it('refuses when the environment decides', async () => {
    process.env[DATA_DIR_ENV] = path.join(tmp, 'forced');
    reloadDataRoot();
    expect((await planDataRootChange(path.join(tmp, 'games'))).problem).toBe('envLocked');
  });

  it('moves into an empty directory and quotes what it weighs', async () => {
    const plan = await planDataRootChange(path.join(tmp, 'games'));
    expect(plan.problem).toBeUndefined();
    expect(plan.action).toBe('move');
    expect(plan.target).toBe(path.join(tmp, 'games'));
    expect(plan.bytesToMove).toBe(await movableSize(userData));
    expect(plan.bytesToMove).toBeGreaterThan(64 + 32);
    // Leaving the home for the first time: the home stays, and the plan says so.
    expect(plan.leavesHome).toBe(true);
  });

  it('makes a folder of its own inside one that holds other things', async () => {
    // Pointed at `D:\Games`, the launcher used to pour `profiles/`, `java/` and
    // `settings.json` in among whatever was there — and the uninstaller's
    // "delete the launcher's data" then meant that whole folder.
    const games = path.join(tmp, 'Games');
    await realFs.mkdir(path.join(games, 'Factorio'), { recursive: true });
    await realFs.writeFile(path.join(games, 'holiday.jpg'), 'not ours');

    const plan = await planDataRootChange(games);

    expect(plan.problem).toBeUndefined();
    expect(plan.action).toBe('move');
    expect(plan.target).toBe(path.join(games, 'raven-forge-launcher'));
  });

  it('refuses when even that folder is somebody else’s', async () => {
    const games = path.join(tmp, 'Games');
    await realFs.mkdir(path.join(games, 'raven-forge-launcher', 'unrelated'), { recursive: true });
    await realFs.writeFile(path.join(games, 'holiday.jpg'), 'not ours');

    expect((await planDataRootChange(games)).problem).toBe('notEmpty');
  });

  it('adopts a directory that already holds profiles', async () => {
    const existing = path.join(tmp, 'old-root');
    await seedLauncherData(existing);
    const plan = await planDataRootChange(existing);
    expect(plan.action).toBe('adopt');
    expect(plan.bytesToMove).toBe(0);
  });

  it('does not mistake a folder the launcher only stood in for a root to adopt', async () => {
    // One start with the drive unplugged leaves a default `settings.json` and
    // four empty directories in the stand-in. Read as "a folder you used
    // before", going back to it switched roots and left every world behind.
    const standIn = path.join(tmp, 'stand-in');
    await seedStandIn(standIn);

    const plan = await planDataRootChange(standIn);

    expect(plan.action).toBe('move');
    expect(plan.replacesDebris).toBe(true);
    expect(plan.bytesToMove).toBeGreaterThan(0);
  });

  it('does not mistake half a copy for a root to adopt either', async () => {
    // An interrupted move leaves profiles at the target too. The marker is what
    // says they are half of something.
    const half = path.join(tmp, 'half');
    await seedLauncherData(half);
    await realFs.writeFile(path.join(half, '.raven-forge-moving'), `from ${userData}\n`);

    const plan = await planDataRootChange(half);

    expect(plan.action).toBe('move');
    expect(plan.replacesDebris).toBe(true);
  });

  it('asks for room only when the files have to be written again', async () => {
    freeBytes = 10; // nowhere near enough for a copy

    // Another folder on the same disk is a rename, and a rename needs no room.
    const near = await planDataRootChange(path.join(tmp, 'games'));
    expect(near.sameVolume).toBe(true);
    expect(near.problem).toBeUndefined();

    const far = await planDataRootChange(await plugIn());
    expect(far.sameVolume).toBe(false);
    expect(far.problem).toBe('noSpace');
  });

  it('says when the path is one some mods trip over', async () => {
    expect(await planDataRootChange(path.join(tmp, 'My Games'))).toMatchObject({
      hasSpaces: true,
      hasNonAscii: false,
    });
    expect(await planDataRootChange(path.join(tmp, 'Świat'))).toMatchObject({
      hasSpaces: false,
      hasNonAscii: true,
    });
    expect(pathConcerns('C:\\Users\\raven\\AppData\\Roaming\\raven-forge-launcher')).toEqual({
      hasSpaces: false,
      hasNonAscii: false,
    });
  });
});

describe('applying it', () => {
  beforeEach(async () => {
    await seedLauncherData(userData);
    await seedBrowserState(userData);
  });

  for (const [label, cross] of [
    ['on the same volume', false],
    ['across volumes', true],
  ] as const) {
    it(`carries the launcher's own files and nothing else, ${label}`, async () => {
      const target = cross ? await plugIn() : path.join(tmp, 'games');

      const result = await applyDataRoot(target);

      expect(result).toEqual({ target, leftovers: [] });
      // Arrived — the log and the crash reports with everything else.
      expect(await list(target)).toEqual([
        'auth.json',
        'crash-reports',
        'java',
        'logs',
        'profiles',
        'profiles.json',
        'settings.json',
      ]);
      expect(await exists(path.join(target, 'profiles', 'p1', '.minecraft', 'mods', 'a.jar'))).toBe(
        true,
      );
      // And what stays in the home is exactly what the dialog said would: the
      // pointer, and the browser's own folder.
      expect(await list(userData)).toEqual(['browser', 'data-root.txt']);
      expect(await exists(path.join(userData, 'browser', 'Cookies'))).toBe(true);

      reloadDataRoot();
      expect(dataRoot()).toBe(target);
      expect(paths.logsDir).toBe(path.join(target, 'logs'));
    });
  }

  it('keeps the mode on auth.json when it has to copy', async () => {
    const target = await plugIn();
    await applyDataRoot(target);

    const mode = (await realFs.stat(path.join(target, 'auth.json'))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('carries an empty folder and a link as what they are when it has to copy', async () => {
    // A profile that has never been launched is an empty directory, and it was
    // neither copied nor spared: gone from both sides. A world linked in from
    // another drive was copied in full where the link had been.
    await realFs.mkdir(path.join(userData, 'profiles', 'never-launched'));
    const elsewhere = path.join(tmp, 'worlds-drive');
    await realFs.mkdir(elsewhere);
    await realFs.symlink(elsewhere, path.join(userData, 'profiles', 'p1', 'saves'));

    const target = await plugIn();
    await applyDataRoot(target);

    expect((await realFs.stat(path.join(target, 'profiles', 'never-launched'))).isDirectory()).toBe(
      true,
    );
    const link = path.join(target, 'profiles', 'p1', 'saves');
    expect((await realFs.lstat(link)).isSymbolicLink()).toBe(true);
    expect(await realFs.readlink(link)).toBe(elsewhere);
  });

  it('reports progress that ends at the full size', async () => {
    const seen: number[] = [];
    await applyDataRoot(await plugIn(), (event) => seen.push(event.progress));

    expect(seen[0]).toBe(0);
    expect(seen.at(-1)).toBe(1);
    expect(seen.every((p, i) => i === 0 || p >= seen[i - 1])).toBe(true);
  });

  it('adopts without touching either side', async () => {
    const existing = path.join(tmp, 'old-root');
    await seedLauncherData(existing);
    await realFs.writeFile(path.join(existing, 'profiles.json'), '[{"id":"theirs"}]');

    await applyDataRoot(existing);

    reloadDataRoot();
    expect(dataRoot()).toBe(existing);
    expect(await realFs.readFile(path.join(existing, 'profiles.json'), 'utf-8')).toBe(
      '[{"id":"theirs"}]',
    );
    // The data that was in use is still where it was, untouched.
    expect(await realFs.readFile(path.join(userData, 'profiles.json'), 'utf-8')).toBe(
      '[{"id":"p1"}]',
    );
  });

  it('moves back to the default, removes the pointer and the folder it left', async () => {
    const away = path.join(tmp, 'games');
    await applyDataRoot(away);
    reloadDataRoot();

    await applyDataRoot(userData);
    reloadDataRoot();

    expect(dataRoot()).toBe(userData);
    expect(await exists(dataRootPointerFile())).toBe(false);
    expect(await exists(path.join(userData, 'profiles', 'p1', '.minecraft', 'mods', 'a.jar'))).toBe(
      true,
    );
    // Nothing of the launcher's is left in the folder it moved out of, so the
    // folder goes too.
    expect(await exists(away)).toBe(false);
  });

  it('replaces what a stand-in left when the data comes back to it', async () => {
    const away = path.join(tmp, 'games');
    await applyDataRoot(away);
    reloadDataRoot();
    // The drive was unplugged for one start, and the home stood in.
    await seedStandIn(userData);

    await applyDataRoot(userData);

    expect(await realFs.readFile(path.join(userData, 'settings.json'), 'utf-8')).toBe(
      '{"theme":"dark"}',
    );
    expect(await exists(path.join(userData, 'profiles', 'p1'))).toBe(true);
  });

  it('puts everything back when a copy fails part-way', async () => {
    const target = await plugIn();
    failCopyAt = path.join('java', 'jre-25');

    await expect(applyDataRoot(target)).rejects.toThrow(/Nothing was moved/);

    // The data is where it was, all of it, and still the root.
    reloadDataRoot();
    expect(dataRoot()).toBe(userData);
    expect(await exists(dataRootPointerFile())).toBe(false);
    expect(await exists(path.join(userData, 'profiles', 'p1', '.minecraft', 'mods', 'a.jar'))).toBe(
      true,
    );
    expect(await exists(path.join(userData, 'auth.json'))).toBe(true);
    // And nothing half-made is left for a later attempt to mistake for a root.
    expect(await exists(target)).toBe(false);
    expect(await exists(path.join(userData, '.raven-forge-moving'))).toBe(false);
  });

  it('puts renamed entries back when a later one cannot be carried', async () => {
    // Same volume, so entries are renamed across one at a time — and the one
    // that will not rename falls back to a copy, which fails too.
    const target = path.join(tmp, 'games');
    failCopyAt = path.join('profiles', 'p1');
    // Make the rename of `profiles` fail by putting a file in its way.
    await realFs.mkdir(target, { recursive: true });
    const realRename = realFs.rename;
    const spy = vi.spyOn(realFs, 'rename').mockImplementation(async (from, to) => {
      if (String(from) === path.join(userData, 'profiles')) throw new Error('held open');
      return realRename(from, to);
    });

    try {
      await expect(applyDataRoot(target)).rejects.toThrow(/Nothing was moved/);
    } finally {
      spy.mockRestore();
    }

    expect(await list(userData)).toEqual([
      'auth.json',
      'browser',
      'crash-reports',
      'java',
      'logs',
      'profiles',
      'profiles.json',
      'settings.json',
    ]);
    expect(await exists(path.join(userData, 'java', 'jre-25', 'bin'))).toBe(true);
  });

  it('says which old copies it could not remove, instead of calling the move clean', async () => {
    const target = await plugIn();
    failRemoveAt = path.join(userData, 'java');

    const result = await applyDataRoot(target);

    // The move itself succeeded and the data is at the target…
    reloadDataRoot();
    expect(dataRoot()).toBe(target);
    expect(await exists(path.join(target, 'java', 'jre-25', 'bin'))).toBe(true);
    // …and the one original that would not go is named, not buried in a log.
    expect(result.leftovers).toEqual([path.join(userData, 'java')]);
  });
});

describe('a move that was cut off', () => {
  it('has what was already carried brought back at the next start', async () => {
    // Renamed one entry at a time, a move can be stopped between two of them:
    // the root then lists every profile and holds none of their folders.
    await seedLauncherData(userData);
    const target = path.join(tmp, 'games');
    await realFs.mkdir(target);
    await realFs.rename(path.join(userData, 'profiles'), path.join(target, 'profiles'));
    await realFs.rename(path.join(userData, 'auth.json'), path.join(target, 'auth.json'));
    await realFs.writeFile(path.join(userData, '.raven-forge-moving'), `to ${target}\n`);
    await realFs.writeFile(path.join(target, '.raven-forge-moving'), `from ${userData}\n`);

    recoverInterruptedMove(userData);

    expect(await exists(path.join(userData, 'profiles', 'p1', '.minecraft', 'mods', 'a.jar'))).toBe(
      true,
    );
    expect(await exists(path.join(userData, 'auth.json'))).toBe(true);
    expect(await exists(path.join(userData, '.raven-forge-moving'))).toBe(false);
  });

  it('does not overwrite what is still here with what was copied there', async () => {
    await seedLauncherData(userData);
    const target = path.join(tmp, 'games');
    await realFs.mkdir(target);
    await realFs.writeFile(path.join(target, 'settings.json'), '{"half":"copied"}');
    await realFs.writeFile(path.join(userData, '.raven-forge-moving'), `to ${target}\n`);

    recoverInterruptedMove(userData);

    expect(await realFs.readFile(path.join(userData, 'settings.json'), 'utf-8')).toBe(
      '{"theme":"dark"}',
    );
  });

  it('only tidies up when the move had in fact arrived', async () => {
    // Stopped after the pointer was written: the target is the data, and all
    // that is left to do is take the markers away.
    const target = path.join(tmp, 'games');
    await seedLauncherData(target);
    await realFs.writeFile(path.join(target, '.raven-forge-moving'), `from ${userData}\n`);
    await realFs.writeFile(path.join(userData, '.raven-forge-moving'), `to ${target}\n`);

    recoverInterruptedMove(target);

    expect(await exists(path.join(target, '.raven-forge-moving'))).toBe(false);
    expect(await exists(path.join(userData, '.raven-forge-moving'))).toBe(false);
    expect(await exists(path.join(target, 'profiles', 'p1'))).toBe(true);
  });

  it('does nothing at all where no move was under way', async () => {
    await seedLauncherData(userData);
    const before = await list(userData);

    recoverInterruptedMove(userData);

    expect(await list(userData)).toEqual(before);
  });
});

describe("what counts as the launcher's own directory", () => {
  beforeEach(() => seedLauncherData(userData));

  /**
   * `system:open-path` runs whatever the OS associates with the target, so it is
   * confined to the launcher's own two folders: the data, and the home the data
   * may have moved out of.
   */
  it('covers the data folder and the home once they are two places', async () => {
    await applyDataRoot(path.join(tmp, 'games'));
    reloadDataRoot();

    expect(paths.isInsideLauncherData(paths.root)).toBe(true);
    expect(paths.isInsideLauncherData(path.join(paths.root, 'profiles', 'p1'))).toBe(true);
    expect(paths.isInsideLauncherData(paths.logsDir)).toBe(true);
    expect(paths.isInsideLauncherData(paths.crashReportsDir)).toBe(true);
    expect(paths.isInsideLauncherData(paths.browserDir)).toBe(true);
    expect(paths.isInsideLauncherData(paths.home)).toBe(true);
    // Neither contains the other.
    expect(path.relative(paths.root, paths.home).startsWith('..')).toBe(true);
  });

  it('still refuses everything else', () => {
    expect(paths.isInsideLauncherData(path.join(tmp, 'elsewhere'))).toBe(false);
    expect(paths.isInsideLauncherData(path.join(paths.root, '..', '..', 'etc'))).toBe(false);
    expect(paths.isInsideLauncherData(`${paths.root}-evil`)).toBe(false);
    expect(paths.isInsideLauncherData('')).toBe(false);
  });

  it('does not take a name that merely starts with two dots for a way out', () => {
    expect(paths.isInsideLauncherData(path.join(paths.root, '..cache', 'x.json'))).toBe(true);
  });
});
