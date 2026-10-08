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
 * A Forge build's number, without the branch some of them carry after it.
 *
 * `10.13.4.1614-1.7.10` and `10.13.4.1614` are one build. Forge's own list
 * spells it the first way for a handful of Minecraft versions — 1.7.10, 1.8.9
 * and 1.9.4 among them — while its promotions feed and every pack on Modrinth
 * spell it the second, so the number is what the two are matched on.
 *
 * Forge only. For the others what follows a hyphen is a prerelease tag, and
 * `0.30.1-beta.4` is not `0.30.1`.
 */
export function forgeBuildNumber(version: string): string {
  return version.split('-')[0];
}

/**
 * The entry of a loader's list that a profile's build names, if it names one.
 *
 * By its own spelling, or — for Forge — by its number: a profile made from a
 * pack holds `11.15.1.1902`, and the list calls that build
 * `11.15.1.1902-1.8.9`. Read as a build that is not on the list, it was
 * replaced with the default the first time the profile was opened in the
 * editor, and saving any change at all then moved the pack to another Forge.
 */
export function listedLoaderVersion(
  versions: readonly LoaderVersion[],
  held: string | undefined,
  loader: string,
): string | undefined {
  if (!held) return undefined;
  if (versions.some((v) => v.version === held)) return held;
  if (loader !== 'forge') return undefined;
  return versions.find((v) => forgeBuildNumber(v.version) === forgeBuildNumber(held))?.version;
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
