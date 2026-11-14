// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs';
import path from 'node:path';
import { app, dialog } from 'electron';
import {
  canHoldLinks,
  carryDiagnostics,
  fileBrowserDataAway,
  keepHomeToOwner,
  resolveAppHome,
  type AppHome,
} from '../core/config/app-home';
import { DATA_DIR_ENV, dataRoot } from '../core/config/data-root';
import { recoverInterruptedMove } from '../core/config/data-root-move';
import { paths } from '../core/config/paths';
import { LOCALES, pickLocale, type Locale } from '../shared/locale';
import { initLogger, log } from './logger';

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
  const appData = app.getPath('appData');
  const home = resolveAppHome(appData, process.env[DATA_DIR_ENV], process.platform);
  // Before anything is made inside it. See keepHomeToOwner.
  if (path.dirname(home.dir) === path.resolve(appData)) keepHomeToOwner(home.dir, process.platform);

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

/**
 * Whether this start is to be refused for where its home is.
 *
 * Only a home that `RAVENFORGE_DATA_DIR` names — a portable install's folder,
 * on a stick, which comes formatted as FAT32 or exFAT and holds no symbolic
 * link (see `canHoldLinks`). Started from there, the launcher used to close
 * without a word and without a log.
 */
export function homeRefused(home: AppHome): boolean {
  const envRoot = process.env[DATA_DIR_ENV];
  if (!envRoot || path.resolve(envRoot) !== home.dir) return false;
  return !canHoldLinks(home.dir, process.platform);
}

/**
 * Say why, in the player's language, and close.
 *
 * The messages are the window's own, read here only when this happens, so a
 * start that is not refused never loads them. If they cannot be loaded, it
 * closes as it did before, with the reason in the log.
 */
export function refuseHome(home: AppHome): void {
  void app.whenReady().then(async () => {
    initLogger();
    log.error(
      `${home.dir} cannot hold a symbolic link, and the single-instance lock is one here — ` +
        'not starting from it',
    );
    try {
      const { translate } = await import('../renderer/i18n/messages.js');
      const locale = startupLocale();
      await dialog.showMessageBox({
        type: 'error',
        title: translate(locale, 'startup.homeCannotHoldLinks.title'),
        message: translate(locale, 'startup.homeCannotHoldLinks.title'),
        detail: translate(locale, 'startup.homeCannotHoldLinks.detail', { folder: home.dir }),
        buttons: [translate(locale, 'common.close')],
        noLink: true,
      });
    } catch (err) {
      log.error('Could not say so in a window:', err);
    }
    app.quit();
  });
}

/** The language the settings hold, read and not written; the system's when there is none. */
function startupLocale(): Locale {
  try {
    const raw = JSON.parse(fs.readFileSync(paths.settings, 'utf-8')) as { language?: unknown };
    const saved = raw.language;
    if (typeof saved === 'string' && (LOCALES as readonly string[]).includes(saved)) {
      return saved as Locale;
    }
  } catch {
    /* nothing saved there, or nothing readable: the system's language */
  }
  return pickLocale(app.getPreferredSystemLanguages());
}
