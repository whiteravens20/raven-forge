// The host machine, as the About and Settings pages report it.
// Part of the IPC contract — see `../ipc-types.ts`.

export interface SystemInfo {
  /**
   * `app.getVersion()` — the version of the build that is actually running.
   * Not the `APP_VERSION` constant, which is a second copy of the same number
   * and drifts from package.json the first time someone bumps only one.
   */
  launcherVersion: string;
  platform: 'win32' | 'linux' | 'darwin';
  arch: string;
  totalMemoryMb: number;
  freeMemoryMb: number;
  dataDirectory: string;
  /** Where the crash reports land, so Settings can offer to open it. */
  crashReportsDirectory: string;
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
