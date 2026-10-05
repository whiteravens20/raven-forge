// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import type { LoaderVersion } from './ipc/profiles';

/**
 * Whether a version string marks itself as unfinished.
 *
 * NeoForge and Quilt publish no flag for this and say it in the version
 * instead — `21.4.0-beta`, `0.30.0-beta.1` — so the string is the only place to
 * read it from.
 */
export function isPrerelease(version: string): boolean {
  return /-(alpha|beta|rc|pre)/i.test(version);
}

/** `0.29.2-beta.1` → the numbers, and the tag after the first hyphen if any. */
function parts(version: string): { core: number[]; pre: string | null } {
  const hyphen = version.indexOf('-');
  const core = hyphen < 0 ? version : version.slice(0, hyphen);
  return {
    core: core.split('.').map((n) => Number.parseInt(n, 10) || 0),
    pre: hyphen < 0 ? null : version.slice(hyphen + 1),
  };
}

/**
 * Order two loader versions, newest first.
 *
 * Needed because not every loader hands its list over in order: Quilt's comes
 * back as `0.20.0-beta.9, 0.20.0-beta.7, …, 0.24.0, …`, so taking the first
 * entry as the newest picked a two-year-old beta. A release sorts above its own
 * prereleases, which is the one thing a plain string comparison gets backwards.
 *
 * Forge's list goes through here too. Its old builds have four numbers and
 * often a branch after the hyphen rather than a prerelease tag —
 * `10.13.4.1614-1.7.10`, `12.18.1.2016-failtests` — but the last number is the
 * build, which no two share, so the numbers settle it before the tag is read.
 */
export function compareLoaderVersionsDesc(a: string, b: string): number {
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.core.length, right.core.length); i++) {
    const diff = (right.core[i] ?? 0) - (left.core[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (left.pre === right.pre) return 0;
  if (left.pre === null) return -1;
  if (right.pre === null) return 1;
  // `numeric` so `beta.10` is after `beta.9`; alpha < beta < pre < rc already
  // falls out of the alphabet.
  return right.pre.localeCompare(left.pre, 'en', { numeric: true });
}

/**
 * The loader build a profile gets when nobody has chosen one.
 *
 * The build its loader recommends, where the loader says — Fabric and Forge
 * each name exactly one per Minecraft version. Otherwise the newest that is not
 * a prerelease, and failing that simply the newest: a Minecraft version that
 * only has betas yet still has to resolve to something, or the profile cannot
 * start. Lists arrive newest first.
 *
 * Shared by the profile editor and the launch path, so the build the form shows
 * as the default is the one a launch would pick on its own.
 */
export function defaultLoaderVersion(versions: readonly LoaderVersion[]): string | undefined {
  return (versions.find((v) => v.recommended) ?? versions.find((v) => v.stable) ?? versions[0])
    ?.version;
}
