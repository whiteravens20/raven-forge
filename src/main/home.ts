// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import path from 'node:path';
import { app } from 'electron';
import {
  carryDiagnostics,
  fileBrowserDataAway,
  resolveAppHome,
  type AppHome,
} from '../core/config/app-home';
import { DATA_DIR_ENV, dataRoot } from '../core/config/data-root';
import { recoverInterruptedMove } from '../core/config/data-root-move';

/** Upper bound for the embedded browser's HTTP cache. */
const BROWSER_CACHE_BYTES = 32 * 1024 * 1024;

/**
 * Settle where the launcher lives, before Electron does anything with a path.
 *
 * Called ahead of the single-instance lock on purpose. The lock is kept in
 * `userData`, so the directory has to be the right one by then — and renaming
 * an old-named home into place is only possible while nothing, this process
 * included, has a file open in it.
 *
 * Everything this does is safe for the copy that then loses the lock: it
 * either finds the work already done by the copy that is running, or finds the
 * directory in use and leaves it alone.
 */
export function establishAppHome(): AppHome {
  const home = resolveAppHome(app.getPath('appData'), process.env[DATA_DIR_ENV], process.platform);

  app.setPath('userData', home.dir);
  if (home.browserDir !== home.dir) {
    fileBrowserDataAway(home);
    // The browser's own files, out from among the launcher's. Left alone,
    // Chromium puts two dozen files and folders beside the profiles — and they
    // are what stayed behind, unexplained, in the folder a player had just
    // moved their data out of.
    app.setPath('sessionData', home.browserDir);
    app.setPath('crashDumps', path.join(home.browserDir, 'Crashpad'));
  }

  // The window shows a handful of icons and news images. Chromium sizes its
  // cache from the free space on the disk, which on a large drive is hundreds
  // of megabytes kept for a launcher.
  app.commandLine.appendSwitch('disk-cache-size', String(BROWSER_CACHE_BYTES));

  // From here the data root can be asked for. Two things about it are put
  // right before anything reads it: a move that was cut off half-way, and the
  // diagnostics of an install whose data had moved before they moved with it.
  const root = dataRoot();
  recoverInterruptedMove(root);
  carryDiagnostics(home.dir, root);

  return home;
}
