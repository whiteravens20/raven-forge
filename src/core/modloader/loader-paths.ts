import path from 'node:path';
import { paths } from '../config/paths';
import { isSafeFileName } from '../../shared/manifest-schema';
import type { ModLoaderType } from '../../shared/ipc-types';

/**
 * Where a loader install lives, for every loader, in one place.
 *
 * There were four of these — two inline in `loader-manager.ts`, one in
 * `forge-installer.ts`, one in `loader-profile.ts` — all producing
 * `loaders/<loader>/<mcVersion>-<loaderVersion>` and none of them checking what
 * went into it. That matters because both halves of the directory name arrive
 * from outside: a pack manifest supplies them and a hand-edited `profiles.json`
 * is never re-parsed on read, so neither reaches here having passed a schema.
 *
 * A version that is not a single path component is refused rather than joined.
 * The failure it prevents is not merely a stray directory: `getLoaderProfilePath`
 * points at a file that is read back and parsed as the version metadata the game
 * launches from, and that metadata carries `mainClass` and the JVM arguments.
 */
export function loaderCacheDir(
  loader: ModLoaderType,
  mcVersion: string,
  loaderVersion: string,
): string {
  for (const part of [mcVersion, loaderVersion]) {
    if (typeof part !== 'string' || !isSafeFileName(part)) {
      throw new Error(`Not a version id: ${JSON.stringify(part)}`);
    }
  }
  return path.join(paths.loadersDir, loader, `${mcVersion}-${loaderVersion}`);
}
