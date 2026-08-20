import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from '../../main/logger';
import {
  getVersionMeta,
  mergeVersionMeta,
  resolveVersionChain,
} from '../minecraft/version-manifest';
import { loaderCacheDir } from './loader-paths';
import type { VersionMeta } from '../minecraft/types';
import type { ModLoaderType } from '../../shared/ipc-types';

// Loaders whose install step produces a version profile JSON on disk.
// Vanilla is the only other member of ModLoaderType, and it needs none.
const PROFILE_FILES: Partial<Record<ModLoaderType, string>> = {
  fabric: 'fabric-profile.json',
  quilt: 'quilt-profile.json',
  forge: 'forge-profile.json',
  neoforge: 'neoforge-profile.json',
};

function getLoaderProfilePath(
  loader: ModLoaderType,
  loaderVersion: string,
  mcVersion: string,
): string | null {
  const fileName = PROFILE_FILES[loader];
  if (!fileName) return null;
  return path.join(loaderCacheDir(loader, mcVersion, loaderVersion), fileName);
}

/**
 * Read a loader's installed profile JSON.
 *
 * Loader profiles are partial version metas: they declare their own
 * `mainClass`, `libraries` and `arguments`, and point at the vanilla version
 * they extend via `inheritsFrom`.
 */
async function readLoaderProfile(
  loader: ModLoaderType,
  loaderVersion: string,
  mcVersion: string,
): Promise<Partial<VersionMeta> | null> {
  const profilePath = getLoaderProfilePath(loader, loaderVersion, mcVersion);
  if (!profilePath) return null;

  try {
    const raw = await fs.readFile(profilePath, 'utf-8');
    return JSON.parse(raw) as Partial<VersionMeta>;
  } catch {
    return null;
  }
}

/**
 * Build the version meta the game should actually launch with.
 *
 * For vanilla profiles this is just `vanillaMeta`. For Fabric/Quilt it is the
 * loader profile resolved against its `inheritsFrom` parent, which swaps in the
 * loader's `mainClass` (e.g. `net.fabricmc.loader.impl.launch.knot.KnotClient`)
 * and prepends the loader's libraries to the classpath. Without this the game
 * launches as plain vanilla and no mods load.
 */
export async function resolveLaunchMeta(
  loader: ModLoaderType,
  loaderVersion: string | undefined,
  mcVersion: string,
  vanillaMeta: VersionMeta,
): Promise<VersionMeta> {
  if (loader === 'vanilla' || !loaderVersion) return vanillaMeta;

  const profile = await readLoaderProfile(loader, loaderVersion, mcVersion);
  if (!profile) {
    log.warn(
      `No ${loader} profile JSON found for MC ${mcVersion} / ${loaderVersion} — launching vanilla`,
    );
    return vanillaMeta;
  }

  // The profile's parent is normally the vanilla version we already fetched;
  // merge against it directly and only go back to the network when it points
  // somewhere else.
  const parent =
    !profile.inheritsFrom || profile.inheritsFrom === vanillaMeta.id
      ? vanillaMeta
      : await resolveVersionChain(await getVersionMeta(profile.inheritsFrom));

  const merged = mergeVersionMeta(parent, profile);
  log.info(`Launch meta: ${loader} ${loaderVersion} on MC ${mcVersion} (${merged.mainClass})`);
  return merged;
}
