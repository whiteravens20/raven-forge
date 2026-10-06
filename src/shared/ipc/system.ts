// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

// The host machine, as the About and Settings pages report it.
// Part of the IPC contract — see `../ipc-types.ts`.

export interface SystemInfo {
  /**
   * `app.getVersion()` — the version of the build that is actually running,
   * read from the one place it is written, package.json.
   */
  launcherVersion: string;
  totalMemoryMb: number;
  dataDirectory: string;
  /** Where the crash reports land, so Settings can offer to open it. */
  crashReportsDirectory: string;
}

/** One place the launcher writes to. The renderer names it; this locates it. */
export type StorageId =
  | 'profiles'
  | 'gameFiles'
  | 'java'
  | 'loaders'
  | 'state'
  | 'logs'
  | 'crashReports'
  | 'browser'
  | 'pointer'
  | 'updateCache'
  | 'program'
  | 'legacyHome';

export interface StorageEntry {
  id: StorageId;
  /**
   * Which of the three kinds of place it is: the data folder, which moves; the
   * launcher's home, which does not; or somewhere the system decides.
   */
  where: 'data' | 'home' | 'system';
  path: string;
  /** Bytes on disk right now, or null when nothing is there. */
  bytes: number | null;
  /** Whether the launcher will open it — only its own two folders. */
  openable: boolean;
}

/**
 * Every place on this computer the launcher writes to, as measured just now.
 *
 * `keychain.secrets` is how many entries the operating system's credential
 * store holds for the launcher — a count, never their contents — or null when
 * the store could not be asked, which on Linux means no keyring service is
 * running.
 */
export interface StorageReport {
  root: string;
  home: string;
  entries: StorageEntry[];
  keychain: {
    platform: 'win32' | 'linux' | 'darwin';
    secrets: number | null;
  };
}

/**
 * A window onto the launcher log, and a cursor for asking what came next.
 *
 * `size` is the file size at the moment of the read. Passing it back as `since`
 * returns only the bytes appended after it, so following a live log does not
 * mean re-reading and re-marshalling the whole tail every couple of seconds.
 */
export interface LogTail {
  lines: string[];
  size: number;
  /** The cursor was not usable — the file rotated, or this is the first read — so `lines` replaces whatever the caller had. */
  reset: boolean;
}
