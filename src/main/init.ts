import fs from 'node:fs/promises';
import { paths } from '../core/config/paths';

/**
 * Ensure all required data directories exist on startup.
 */
export async function ensureDataDirectories(): Promise<void> {
  const dirs = [paths.profilesDir, paths.loadersDir, paths.javaDir, paths.cacheDir, paths.logsDir];

  await Promise.all(dirs.map((dir) => fs.mkdir(dir, { recursive: true })));
}
