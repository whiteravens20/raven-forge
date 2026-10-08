// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { log } from '../../main/logger';
import { FABRIC_META_API, QUILT_META_API } from '../../shared/constants';
import { emitProgress } from '../util/progress';
import {
  getForgeVersions,
  getNeoForgeVersions,
  installForgeLike,
  isWorkingForgeLikeBuild,
  type LoaderInstallOptions,
} from './forge-installer';
import { isLoaderProfileComplete, loaderProfilePath, readLoaderProfile } from './loader-profile';
import { withTimeout } from '../util/cancellation';
import { writeJsonAtomic } from '../util/atomic-file';
import {
  compareLoaderVersionsDesc,
  defaultLoaderVersion,
  isPrerelease,
} from '../../shared/loader-version';
import { getCachedVersionMeta } from '../minecraft/version-manifest';
import { requiredJavaFor } from '../minecraft/java-requirement';
import { startsMinecraft, type LoaderEntry, type MetaLoader } from './loader-fit';
import type { ModLoaderType, ProgressEvent, LoaderVersion } from '../../shared/ipc-types';

function emitLoaderProgress(event: ProgressEvent): void {
  emitProgress('progress:loader-install', event);
}

// ── Fabric and Quilt ───────────────────────────────────────
// The two publish the same thing at the same kind of address: a list of loader
// builds per Minecraft version, and for each a ready-made version profile.

const META_LOADERS: Record<MetaLoader, { api: string; label: string }> = {
  fabric: { api: FABRIC_META_API, label: 'Fabric' },
  quilt: { api: QUILT_META_API, label: 'Quilt' },
};

async function getMetaLoaderVersions(
  loader: MetaLoader,
  mcVersion: string,
): Promise<LoaderVersion[]> {
  const { api, label } = META_LOADERS[loader];
  const res = await fetch(`${api}/versions/loader/${mcVersion}`, {
    signal: AbortSignal.timeout(10000),
  });
  // Neither answers a Minecraft version it has nothing for with an empty list:
  // Fabric says 400 and Quilt 404. That is an answer, not a failure, and it is
  // the one every release before 1.14 gets — reported as a failure, the editor
  // said the list could not be loaded and offered a box to type a build into.
  if (res.status === 400 || res.status === 404) {
    log.info(`${label} has no builds for Minecraft ${mcVersion}`);
    return [];
  }
  if (!res.ok) throw new Error(`${label} API error: ${res.status}`);

  const data = (await res.json()) as LoaderEntry[];

  // What the service lists is every build there is, whatever the Minecraft
  // version; what is offered is the ones that start this one. The Java is what
  // Mojang's metadata says when a launch has already fetched it, and what the
  // release number says otherwise — nobody is asked just to draw a list.
  const java = requiredJavaFor(mcVersion, await getCachedVersionMeta(mcVersion));

  return (
    data
      .filter((entry) => startsMinecraft(loader, entry, mcVersion, java))
      .map((entry) => ({
        version: entry.loader.version,
        stable: !isPrerelease(entry.loader.version),
        // Fabric's own `stable` is true for exactly one build, the current one,
        // which makes it a recommendation rather than a verdict on the others.
        // Quilt sends no such field.
        recommended: entry.loader.stable === true,
      }))
      // Fabric's list is newest first already; Quilt's is in no order at all.
      .sort((a, b) => compareLoaderVersionsDesc(a.version, b.version))
  );
}

async function installMetaLoader(
  loader: MetaLoader,
  loaderVersion: string,
  mcVersion: string,
  signal?: AbortSignal,
): Promise<void> {
  const { api, label } = META_LOADERS[loader];
  const opId = `loader-${loader}-${mcVersion}-${loaderVersion}`;
  // Before the request: a version that is not a path component is refused
  // here, and should not have been sent to anyone first.
  const destination = loaderProfilePath(loader, loaderVersion, mcVersion);

  emitLoaderProgress({
    operationId: opId,
    progress: 0,
    message: { key: 'progress.msg.loaderProfile', vars: { loader: label } },
    installing: true,
  });

  log.info(`Fetching ${label} profile JSON for MC ${mcVersion} / loader ${loaderVersion}`);
  const res = await fetch(`${api}/versions/loader/${mcVersion}/${loaderVersion}/profile/json`, {
    signal: withTimeout(signal, 15000),
  });
  if (!res.ok) throw new Error(`Failed to fetch ${label} profile: ${res.status}`);

  // Written whole or not at all: this file is what "installed" means, so a
  // write cut short must not leave something that passes for it.
  await writeJsonAtomic(destination, await res.json());

  emitLoaderProgress({
    operationId: opId,
    progress: 1,
    message: { key: 'progress.msg.loaderInstalled', vars: { loader: label } },
  });
  log.info(`Installed ${label} loader ${loaderVersion} for MC ${mcVersion}`);
}

// ── Unified API (matches ipc-handlers imports) ─────────────

export async function getLoaderVersions(
  loader: ModLoaderType,
  mcVersion: string,
): Promise<LoaderVersion[]> {
  switch (loader) {
    case 'fabric':
    case 'quilt':
      return getMetaLoaderVersions(loader, mcVersion);
    case 'forge':
      return getForgeVersions(mcVersion);
    case 'neoforge':
      return getNeoForgeVersions(mcVersion);
    case 'vanilla':
      return [];
    default:
      throw new Error(`Unknown loader: ${loader}`);
  }
}

/**
 * Whether a build is one this launcher would offer for a Minecraft version —
 * worked out from what is on this machine, with nobody asked.
 *
 * A profile can hold a build that was never chosen from a list: a pack names
 * the one it wants, and it is installed as asked. When such a profile then
 * fails to start, this is what says the build may be why. It is the rules the
 * lists are drawn by, put to a single build: Forge and NeoForge are judged by
 * the build's name, Fabric and Quilt by the libraries their installed profile
 * lists as well. A Fabric or Quilt build that is not installed has only its
 * number to go by, and a build nobody ever published passes — neither is
 * something to tell a player their profile is wrong about.
 */
export async function loaderBuildStarts(
  loader: ModLoaderType,
  loaderVersion: string,
  mcVersion: string,
): Promise<boolean> {
  switch (loader) {
    case 'vanilla':
      return true;
    case 'forge':
    case 'neoforge':
      return isWorkingForgeLikeBuild(loader, loaderVersion, mcVersion);
    case 'fabric':
    case 'quilt': {
      const profile = await readLoaderProfile(loader, loaderVersion, mcVersion);
      const java = requiredJavaFor(mcVersion, await getCachedVersionMeta(mcVersion));
      const entry: LoaderEntry = {
        loader: { version: loaderVersion },
        launcherMeta: { libraries: { common: profile?.libraries ?? [] } },
      };
      return startsMinecraft(loader, entry, mcVersion, java);
    }
    default:
      throw new Error(`Unknown loader: ${loader}`);
  }
}

/**
 * The build to use for a loader nobody pinned a version of, or undefined when
 * the loader publishes nothing for this Minecraft version.
 */
export async function resolveDefaultLoaderVersion(
  loader: ModLoaderType,
  mcVersion: string,
): Promise<string | undefined> {
  return defaultLoaderVersion(await getLoaderVersions(loader, mcVersion));
}

export async function installLoader(
  loader: ModLoaderType,
  loaderVersion: string,
  mcVersion: string,
  options: LoaderInstallOptions = {},
): Promise<void> {
  switch (loader) {
    case 'fabric':
    case 'quilt':
      return installMetaLoader(loader, loaderVersion, mcVersion, options.signal);
    case 'forge':
    case 'neoforge':
      return installForgeLike(
        loader,
        loaderVersion,
        mcVersion,
        (progress, message) =>
          emitLoaderProgress({
            operationId: `loader-${loader}-${mcVersion}-${loaderVersion}`,
            progress,
            message,
            installing: progress < 1,
          }),
        options,
      );
    case 'vanilla':
      return; // nothing to install
    default:
      throw new Error(`Unknown loader: ${loader}`);
  }
}

/**
 * Whether a loader build is installed — which is to say, whether the version
 * profile its install leaves behind is there and usable, with the files only
 * that install could have made.
 *
 * Asked of the profile's contents and not merely of the file's existence. The
 * launch reinstalls whatever this says is missing, so a profile that will not
 * parse has to count as missing, or it is never replaced and the profile it
 * belongs to never starts again.
 */
export async function isLoaderInstalled(
  loader: ModLoaderType,
  loaderVersion: string,
  mcVersion: string,
): Promise<boolean> {
  if (loader === 'vanilla') return true;
  return isLoaderProfileComplete(loader, loaderVersion, mcVersion);
}
