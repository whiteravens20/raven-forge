import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import type { DataRootSource } from '../../shared/ipc/settings';

/**
 * Where the launcher keeps its data, and how that stops being the default.
 *
 * Everything else resolves paths through `paths.ts`, which asks this module for
 * the root. That indirection is the whole feature: a profile's assets, the
 * managed JREs and the loader installers are several gigabytes and used to land
 * on the system drive with no way out.
 *
 * The pointer cannot live in the directory it points at, so it stays in
 * Electron's own `userData` — the one location that is always known without
 * having read anything. It is the only launcher file there once the root has
 * moved, apart from the diagnostics `paths.ts` deliberately pins (see the note
 * on `logsDir` there).
 *
 * One line of plain text, not JSON, and that is a deliberate choice about a
 * *second* reader: Windows' uninstaller has to follow this file to make good on
 * "delete my data", and reading a path out of JSON in NSIS means hunting for a
 * key with `StrLoc` and then undoing the backslash escaping by hand. A single
 * line is three instructions there and `readFileSync().trim()` here, and a
 * person who finds the file can read it too.
 *
 * `RAVENFORGE_DATA_DIR` outranks the pointer and is not written by the UI: it
 * exists so a portable install can carry its data on the same stick as the
 * binary, where nothing may be written to the host machine at all.
 */

const POINTER_FILE = 'data-root.txt';

export const DATA_DIR_ENV = 'RAVENFORGE_DATA_DIR';

interface Resolved {
  path: string;
  source: DataRootSource;
  /**
   * Set when a configured root could not be used and the default is standing in
   * — an unplugged drive, an unmounted share. Recorded rather than swallowed
   * because the alternative is a launcher that silently comes up with no
   * profiles and then writes a fresh `settings.json` over the top of nothing,
   * which looks exactly like having lost everything.
   */
  unavailable?: string;
}

let resolved: Resolved | null = null;

/** Electron's own per-user directory — the root when nothing says otherwise. */
export function defaultDataRoot(): string {
  return app.getPath('userData');
}

/** Always in `userData`, never in the root it names. */
export function dataRootPointerFile(): string {
  return path.join(app.getPath('userData'), POINTER_FILE);
}

function readPointer(): string | null {
  let raw: string;
  try {
    raw = fs.readFileSync(dataRootPointerFile(), 'utf-8');
  } catch {
    return null;
  }
  const dir = raw.trim();
  return dir !== '' && path.isAbsolute(dir) ? path.resolve(dir) : null;
}

function usable(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function resolve(): Resolved {
  if (resolved) return resolved;

  const fromEnv = process.env[DATA_DIR_ENV];
  if (fromEnv && path.isAbsolute(fromEnv)) {
    // An env root is created rather than second-guessed: it is set by whoever
    // launched the process, and on a portable install the stick is empty.
    const dir = path.resolve(fromEnv);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      /* reported below, by way of the fallback */
    }
    resolved = usable(dir)
      ? { path: dir, source: 'env' }
      : { path: defaultDataRoot(), source: 'default', unavailable: dir };
    return resolved;
  }

  const pointed = readPointer();
  if (pointed) {
    resolved = usable(pointed)
      ? { path: pointed, source: 'pointer' }
      : { path: defaultDataRoot(), source: 'default', unavailable: pointed };
    return resolved;
  }

  resolved = { path: defaultDataRoot(), source: 'default' };
  return resolved;
}

export function dataRoot(): string {
  return resolve().path;
}

export function dataRootSource(): DataRootSource {
  return resolve().source;
}

/** The configured root that could not be reached, if the default is standing in. */
export function dataRootUnavailable(): string | undefined {
  return resolve().unavailable;
}

/** Forget what was resolved, so the next question re-reads the pointer. */
export function reloadDataRoot(): void {
  resolved = null;
}

/**
 * Point at `dir`, or at nothing to go back to the default.
 *
 * Writing the default path as a pointer would work and is still not done: an
 * absent file is the state that survives the user's profile being copied to
 * another machine, where that path does not exist.
 */
export async function writeDataRootPointer(dir: string | null): Promise<void> {
  const file = dataRootPointerFile();
  if (dir === null || path.resolve(dir) === path.resolve(defaultDataRoot())) {
    await fsp.rm(file, { force: true });
  } else {
    await fsp.writeFile(file, `${path.resolve(dir)}\n`, 'utf-8');
  }
  reloadDataRoot();
}
