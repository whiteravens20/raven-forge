// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import {
  DIR_PROFILES,
  FILE_DATA_ROOT_POINTER,
  FILE_PROFILES,
  FILE_SETTINGS,
} from '../../shared/constants';
import type { DataRootSource } from '../../shared/ipc/settings';

/**
 * Where the launcher keeps its data, and how that stops being the default.
 *
 * Everything else resolves paths through `paths.ts`, which asks this module for
 * the root. That indirection is the whole feature: a profile's assets, the
 * managed JREs and the loader installers are several gigabytes and used to land
 * on the system drive with no way out.
 *
 * The pointer cannot live in the directory it points at, so it stays in the
 * launcher's home — Electron's `userData`, the one location that is always
 * known without having read anything (see `app-home.ts` for where that is).
 * Once the data has moved, the pointer and the embedded browser's own files are
 * all that is left there.
 *
 * One line of plain text, not JSON, and that is a deliberate choice about a
 * *second* reader: Windows' uninstaller has to follow this file to make good on
 * "delete my data", and reading a path out of JSON in NSIS means hunting for a
 * key with `StrLoc` and then undoing the backslash escaping by hand. A single
 * line is three instructions there and one `trim()` here, and a person who
 * finds the file can read it too.
 *
 * It is written as UTF-16 with a byte-order mark for the same reader. NSIS
 * reads a file in the system's ANSI code page unless told otherwise, so a
 * UTF-8 pointer to `D:\Gry\Świat` reached the uninstaller as a path that does
 * not exist — it then named the wrong folder in its question and deleted
 * nothing. `FileReadUTF16LE` has no such dependency on the machine's locale.
 * A pointer written by an older build is UTF-8; both are read.
 *
 * `RAVENFORGE_DATA_DIR` outranks the pointer and is not written by the UI: it
 * exists so a portable install can carry its data on the same stick as the
 * binary. With it set the home is that directory as well, so nothing at all is
 * written to the host machine.
 */

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

/** The launcher's home — the root when nothing says otherwise. */
export function defaultDataRoot(): string {
  return app.getPath('userData');
}

/** Always in the home, never in the root it names. */
export function dataRootPointerFile(): string {
  return path.join(app.getPath('userData'), FILE_DATA_ROOT_POINTER);
}

const UTF16LE_BOM = Buffer.from([0xff, 0xfe]);

/** The pointer's text, whichever of the two encodings it was written in. */
export function decodePointer(raw: Buffer): string {
  const text = raw.subarray(0, 2).equals(UTF16LE_BOM)
    ? raw.subarray(2).toString('utf16le')
    : raw.toString('utf-8');
  return text.trim();
}

/** The pointer as the uninstaller reads it: UTF-16LE, marked, one line. */
export function encodePointer(dir: string): Buffer {
  return Buffer.concat([UTF16LE_BOM, Buffer.from(`${dir}\r\n`, 'utf16le')]);
}

function readPointer(): string | null {
  const file = dataRootPointerFile();
  let raw: Buffer;
  try {
    raw = fs.readFileSync(file);
  } catch {
    return null;
  }
  const dir = decodePointer(raw);
  if (dir === '' || !path.isAbsolute(dir)) return null;

  // A pointer an older build wrote is put into the form the uninstaller reads,
  // the first time it is read: otherwise an install whose data moved before
  // this build would go on carrying a pointer the uninstaller cannot follow.
  if (!raw.subarray(0, 2).equals(UTF16LE_BOM)) {
    try {
      fs.writeFileSync(file, encodePointer(dir));
    } catch {
      /* read-only home: it still reads, and the next start tries again */
    }
  }
  return path.resolve(dir);
}

/** What marks a directory as somewhere the launcher has lived. */
const ROOT_MARKERS = [FILE_SETTINGS, FILE_PROFILES, DIR_PROFILES];

/**
 * Whether a configured root is really there.
 *
 * Being a directory is not enough. A drive that is not plugged in often leaves
 * its mount point behind as an empty folder, and taking that for the root
 * meant starting with no profiles and then writing a fresh, empty set of
 * launcher files onto the wrong disk. A root the launcher has used holds at
 * least its settings, so the absence of all of them means the data is not here.
 */
function usable(dir: string): boolean {
  try {
    if (!fs.statSync(dir).isDirectory()) return false;
  } catch {
    return false;
  }
  return ROOT_MARKERS.some((marker) => fs.existsSync(path.join(dir, marker)));
}

function isDirectory(dir: string): boolean {
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
    // Only that it exists: an env root starts out empty by design.
    resolved = isDirectory(dir)
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
    await fsp.writeFile(file, encodePointer(path.resolve(dir)));
  }
  reloadDataRoot();
}
