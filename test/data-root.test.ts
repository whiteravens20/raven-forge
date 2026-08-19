import realFs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The movable data directory.
 *
 * The cases here are the ones where being wrong costs somebody their profiles:
 * a move that drags Chromium's session onto another volume, a copy that loses
 * the 0600 on `auth.json`, a pointer at an unplugged drive answered by silently
 * starting empty, and a target inside the source — which would copy the
 * directory into itself.
 */

let userData: string;
let running = false;
let crossVolume = false;

vi.mock('electron', () => ({
  app: { getPath: () => userData },
}));
vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));
vi.mock('../src/core/minecraft/game-launcher', () => ({
  anyGameRunning: () => running,
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const rename = async (from: string, to: string) => {
    if (crossVolume) {
      const err = new Error('cross-device link not permitted') as NodeJS.ErrnoException;
      err.code = 'EXDEV';
      throw err;
    }
    return actual.rename(from, to);
  };
  const patched = { ...actual, rename };
  return { ...patched, default: patched };
});

const {
  dataRoot,
  dataRootSource,
  dataRootUnavailable,
  reloadDataRoot,
  writeDataRootPointer,
  dataRootPointerFile,
  DATA_DIR_ENV,
} = await import('../src/core/config/data-root');
const { planDataRootChange, applyDataRoot, movableSize } =
  await import('../src/core/config/data-root-move');

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
}

/** What Electron itself keeps in `userData`, plus the diagnostics we pin there. */
async function seedForeignState(root: string) {
  await realFs.writeFile(path.join(root, 'Cookies'), 'chromium');
  await realFs.mkdir(path.join(root, 'Local Storage'), { recursive: true });
  await realFs.writeFile(path.join(root, 'Local Storage', 'leveldb'), 'chromium');
  await realFs.mkdir(path.join(root, 'logs'), { recursive: true });
  await realFs.writeFile(path.join(root, 'logs', 'main.log'), 'log');
  await realFs.mkdir(path.join(root, 'crash-reports'), { recursive: true });
}

const exists = (p: string) =>
  realFs
    .stat(p)
    .then(() => true)
    .catch(() => false);

beforeEach(async () => {
  tmp = await realFs.mkdtemp(path.join(os.tmpdir(), 'rf-data-root-'));
  userData = path.join(tmp, 'userData');
  await realFs.mkdir(userData, { recursive: true });
  running = false;
  crossVolume = false;
  delete process.env[DATA_DIR_ENV];
  reloadDataRoot();
});

afterEach(async () => {
  delete process.env[DATA_DIR_ENV];
  reloadDataRoot();
  await realFs.rm(tmp, { recursive: true, force: true });
});

describe('resolving the root', () => {
  it("is Electron's userData when nothing says otherwise", () => {
    expect(dataRoot()).toBe(userData);
    expect(dataRootSource()).toBe('default');
  });

  it('follows a pointer, and forgets it again when it is cleared', async () => {
    const elsewhere = path.join(tmp, 'games');
    await realFs.mkdir(elsewhere);
    await writeDataRootPointer(elsewhere);
    expect(dataRoot()).toBe(elsewhere);
    expect(dataRootSource()).toBe('pointer');

    await writeDataRootPointer(null);
    expect(dataRoot()).toBe(userData);
    expect(await exists(dataRootPointerFile())).toBe(false);
  });

  it('writes no pointer for the default path, so the state survives being copied', async () => {
    await writeDataRootPointer(userData);
    expect(await exists(dataRootPointerFile())).toBe(false);
    expect(dataRootSource()).toBe('default');
  });

  it('stands in for an unreachable root, and says which one', async () => {
    const unplugged = path.join(tmp, 'external', 'games');
    await realFs.mkdir(path.dirname(unplugged), { recursive: true });
    await realFs.mkdir(unplugged);
    await writeDataRootPointer(unplugged);
    await realFs.rm(path.join(tmp, 'external'), { recursive: true, force: true });
    reloadDataRoot();

    expect(dataRoot()).toBe(userData);
    expect(dataRootSource()).toBe('default');
    expect(dataRootUnavailable()).toBe(unplugged);
  });

  it('lets the environment outrank a pointer', async () => {
    const pointed = path.join(tmp, 'pointed');
    const forced = path.join(tmp, 'forced');
    await realFs.mkdir(pointed);
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
    const inside = path.join(userData, 'profiles', 'nested');
    await realFs.mkdir(inside, { recursive: true });
    expect((await planDataRootChange(inside)).problem).toBe('nested');
  });

  it('refuses while a game is running', async () => {
    running = true;
    expect((await planDataRootChange(path.join(tmp, 'elsewhere'))).problem).toBe('gameRunning');
  });

  it('refuses when the environment decides', async () => {
    process.env[DATA_DIR_ENV] = path.join(tmp, 'forced');
    reloadDataRoot();
    expect((await planDataRootChange(path.join(tmp, 'elsewhere'))).problem).toBe('envLocked');
  });

  it('moves into an empty directory and quotes what it weighs', async () => {
    const plan = await planDataRootChange(path.join(tmp, 'empty'));
    expect(plan.problem).toBeUndefined();
    expect(plan.action).toBe('move');
    expect(plan.bytesToMove).toBe(await movableSize(userData));
    expect(plan.bytesToMove).toBeGreaterThan(0);
  });

  it('adopts a directory that already holds launcher data', async () => {
    const previous = path.join(tmp, 'previous');
    await seedLauncherData(previous);
    const plan = await planDataRootChange(previous);
    expect(plan.action).toBe('adopt');
    expect(plan.bytesToMove).toBe(0);
  });
});

describe('applying it', () => {
  beforeEach(async () => {
    await seedLauncherData(userData);
    await seedForeignState(userData);
  });

  for (const [label, cross] of [
    ['on the same volume', false],
    ['across volumes', true],
  ] as const) {
    it(`carries the launcher's own files and nothing else, ${label}`, async () => {
      crossVolume = cross;
      const target = path.join(tmp, 'games');
      await applyDataRoot(target);

      expect(dataRoot()).toBe(target);
      expect(await exists(path.join(target, 'profiles', 'p1', '.minecraft', 'mods', 'a.jar'))).toBe(
        true,
      );
      expect(await exists(path.join(target, 'java', 'jre-25', 'bin'))).toBe(true);
      expect(await exists(path.join(target, 'settings.json'))).toBe(true);
      expect(await exists(path.join(userData, 'profiles'))).toBe(false);

      // Chromium's own state, the log being written, and the pointer itself all
      // belong to userData and must not have travelled.
      expect(await exists(path.join(userData, 'Cookies'))).toBe(true);
      expect(await exists(path.join(userData, 'Local Storage', 'leveldb'))).toBe(true);
      expect(await exists(path.join(userData, 'logs', 'main.log'))).toBe(true);
      expect(await exists(path.join(userData, 'crash-reports'))).toBe(true);
      expect(await exists(dataRootPointerFile())).toBe(true);
      expect(await exists(path.join(target, 'Cookies'))).toBe(false);
      expect(await exists(path.join(target, 'logs'))).toBe(false);
      expect(await exists(path.join(target, 'data-root.json'))).toBe(false);
    });
  }

  it('keeps the mode on auth.json when it has to copy', async () => {
    crossVolume = true;
    const target = path.join(tmp, 'games');
    await applyDataRoot(target);
    const { mode } = await realFs.stat(path.join(target, 'auth.json'));
    expect(mode & 0o777).toBe(0o600);
  });

  it('reports progress that ends at the full size', async () => {
    crossVolume = true;
    const total = await movableSize(userData);
    const seen: number[] = [];
    await applyDataRoot(path.join(tmp, 'games'), (event) => {
      expect(event.bytesTotal).toBe(total);
      seen.push(event.progress);
    });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.at(-1)).toBeCloseTo(1, 5);
  });

  it('adopts without touching either side', async () => {
    const previous = path.join(tmp, 'previous');
    await seedLauncherData(previous);
    await realFs.writeFile(path.join(previous, 'settings.json'), '{"theme":"light"}');

    await applyDataRoot(previous);

    expect(dataRoot()).toBe(previous);
    expect(await realFs.readFile(path.join(previous, 'settings.json'), 'utf-8')).toBe(
      '{"theme":"light"}',
    );
    // The old root keeps what it had; adopting is not a merge.
    expect(await exists(path.join(userData, 'profiles', 'p1'))).toBe(true);
  });

  it('moves back to the default and removes the pointer', async () => {
    const target = path.join(tmp, 'games');
    await applyDataRoot(target);
    await applyDataRoot(userData);

    expect(dataRoot()).toBe(userData);
    expect(await exists(dataRootPointerFile())).toBe(false);
    expect(await exists(path.join(userData, 'profiles', 'p1', '.minecraft', 'mods', 'a.jar'))).toBe(
      true,
    );
  });
});
