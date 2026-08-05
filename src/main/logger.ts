import log from 'electron-log';
import path from 'node:path';
import { app } from 'electron';

/**
 * Initialize electron-log with rotation and sensible defaults.
 * Call this as early as possible in the main process.
 */
export function initLogger(): void {
  const logsDir = path.join(app.getPath('userData'), 'logs');

  log.transports.file.resolvePathFn = () => path.join(logsDir, 'main.log');
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
  log.info(`User data: ${app.getPath('userData')}`);
}

export { log };
