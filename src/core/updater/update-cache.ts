// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** electron-updater's download cache, at the address it works out for itself. */
export function updaterCacheDir(): string {
  const base =
    process.platform === 'win32'
      ? (process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'))
      : process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Caches')
        : (process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'));
  // `updaterCacheDirName` in app-update.yml, which electron-builder derives
  // from the package name.
  return path.join(base, 'raven-forge-launcher-updater');
}

/**
 * Throw away an update that was downloaded and will never be installed.
 *
 * electron-updater keeps a finished download in `pending/` until it installs
 * it, and clears the folder only on its way to the next download. So an update
 * fetched by a launcher that then never quit in the ordinary way — it crashed,
 * the machine was switched off — stays there; and when the player gets the new
 * version another way, by downloading it and installing it by hand, nothing
 * ever asks for that file again. It is a whole installer, a hundred megabytes
 * and more, kept until some later release happens to push it out.
 *
 * Called when a check has found nothing newer than what is running, which is
 * the moment such a file is known to be of no use: whatever it installs is
 * this version or an older one.
 *
 * Only `pending/` goes. Beside it on Windows is the copy of the installer the
 * program was installed from, which the next update is worked out against.
 */
export async function clearPendingUpdate(cacheDir: string = updaterCacheDir()): Promise<void> {
  await fs.rm(path.join(cacheDir, 'pending'), { recursive: true, force: true });
}
