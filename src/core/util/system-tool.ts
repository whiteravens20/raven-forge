// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import path from 'node:path';

/**
 * One of the operating system's own programs, as something to start.
 *
 * On Windows that is its full path. A program started there by its name alone
 * is looked for in the folder the launcher happened to be started from before
 * anywhere else, and only then along `PATH`: a `tar.exe` lying in that folder
 * was what unpacked the Java runtime, and a different tar earlier on the path
 * — Git's, MSYS's — unpacked it by rules of its own. The two programs this is
 * asked for are Windows' own, and Windows keeps them in System32: `taskkill`
 * always has been there, `tar` since Windows 10 1803.
 *
 * Anywhere else the name is the answer. There the search is `PATH` and nothing
 * but, and where the system keeps its tar is the system's to say.
 */
export function systemTool(
  name: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform !== 'win32') return name;
  // Set in every Windows process there is; the fallbacks are for an environment
  // somebody emptied on purpose.
  const windows = env.SystemRoot ?? env.windir ?? 'C:\\Windows';
  return path.win32.join(windows, 'System32', `${name}.exe`);
}
