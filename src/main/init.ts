import fs from 'node:fs/promises';
import { paths } from '../core/config/paths';

/**
 * Ensure all required data directories exist on startup.
 */
export async function ensureDataDirectories(): Promise<void> {
  // `crashReportsDir` is created empty on purpose: Settings offers a button that
  // opens it, and a button that fails until the first crash is worse than a
  // folder that answers "nothing has crashed".
  const dirs = [
    paths.profilesDir,
    paths.loadersDir,
    paths.javaDir,
    paths.cacheDir,
    paths.logsDir,
    paths.crashReportsDir,
  ];

  await Promise.all(dirs.map((dir) => fs.mkdir(dir, { recursive: true })));
}
