// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from '../../main/logger';
import {
  getVersionMeta,
  mergeVersionMeta,
  resolveVersionChain,
} from '../minecraft/version-manifest';
import { loaderCacheDir } from './loader-paths';
import { loaderLabel } from '../../shared/labels';
import type { VersionMeta } from '../minecraft/types';
import type { ModLoaderType } from '../../shared/ipc-types';

/** Every loader but vanilla, which installs nothing and has no profile. */
export type InstallableLoader = Exclude<ModLoaderType, 'vanilla'>;

/** Where installing a loader leaves its version profile, and where it is read from. */
export function loaderProfilePath(
  loader: InstallableLoader,
  loaderVersion: string,
  mcVersion: string,
): string {
  return path.join(loaderCacheDir(loader, mcVersion, loaderVersion), `${loader}-profile.json`);
}

/**
 * Read a loader's installed profile JSON, or null when there is none to use.
 *
 * Loader profiles are partial version metas: they declare their own
 * `mainClass`, `libraries` and `arguments`, and point at the vanilla version
 * they extend via `inheritsFrom`.
 *
 * A file that does not parse, or that names no `mainClass`, counts as absent.
 * It is the one field a loader cannot do without — merged over vanilla without
 * it, the result *is* vanilla — and "absent" is what makes the launch install
 * the loader again instead of going on with a profile that says nothing.
 */
export async function readLoaderProfile(
  loader: InstallableLoader,
  loaderVersion: string,
  mcVersion: string,
): Promise<Partial<VersionMeta> | null> {
  // Outside the `try`: a version that is not a path component is a refusal to
  // be heard, not a file that happens to be missing.
  const file = loaderProfilePath(loader, loaderVersion, mcVersion);
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf-8')) as Partial<VersionMeta> | null;
    return parsed && typeof parsed.mainClass === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Build the version meta the game should actually launch with.
 *
 * For vanilla profiles this is just `vanillaMeta`. For every loader it is the
 * loader profile resolved against its `inheritsFrom` parent, which swaps in the
 * loader's `mainClass` (e.g. `net.fabricmc.loader.impl.launch.knot.KnotClient`)
 * and prepends the loader's libraries to the classpath.
 *
 * A modded profile with nothing to merge is refused. It used to be answered
 * with `vanillaMeta` and a line in the log: the game then started without a
 * loader, the mods sat in `mods/` unread, and the only thing on screen was a
 * main menu with no mod button on it — the launch looked like it had worked.
 */
export async function resolveLaunchMeta(
  loader: ModLoaderType,
  loaderVersion: string | undefined,
  mcVersion: string,
  vanillaMeta: VersionMeta,
): Promise<VersionMeta> {
  if (loader === 'vanilla') return vanillaMeta;
  if (!loaderVersion) {
    throw new Error(`No ${loaderLabel(loader)} version was chosen for Minecraft ${mcVersion}`);
  }

  const profile = await readLoaderProfile(loader, loaderVersion, mcVersion);
  if (!profile) {
    throw new Error(
      `${loaderLabel(loader)} ${loaderVersion} is not installed for Minecraft ${mcVersion}`,
    );
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
