// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import log from 'electron-log';
import path from 'node:path';
import { app } from 'electron';
import { paths } from '../core/config/paths';

/** The launcher's own log, inside `paths.logsDir`. */
export const LOG_FILE = 'main.log';

/**
 * Initialize electron-log with rotation and sensible defaults.
 * Call this as early as possible in the main process.
 */
export function initLogger(): void {
  // Asked at every write, not once here: the log lives in the data folder, and
  // when that folder moves the lines written between the move and the restart
  // have to follow it — written to the old place they would recreate, in the
  // folder the player has just emptied, the one file they find there.
  log.transports.file.resolvePathFn = () => path.join(paths.logsDir, LOG_FILE);
  log.transports.file.maxSize = 5 * 1024 * 1024; // 5 MB
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';

  log.transports.console.format = '[{h}:{i}:{s}] [{level}] {text}';

  // Replace global console with electron-log in production
  if (!app.isPackaged) {
    log.transports.console.level = 'debug';
  } else {
    log.transports.console.level = 'warn';
    Object.assign(console, log.functions);
  }

  log.info(`Raven Forge Launcher v${app.getVersion()} starting...`);
  log.info(`Platform: ${process.platform} ${process.arch}`);
  log.info(`Electron: ${process.versions.electron}, Node: ${process.versions.node}`);
  log.info(`Home: ${paths.home}`);
  log.info(`Data: ${paths.root}`);
}

export { log };
