// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

/**
 * A Minecraft release's number as numbers, or null for an id that has none.
 *
 * Two schemes, and the second sorts after the first as it should: `1.21.11` is
 * `[1, 21, 11]` and `26.3` is `[26, 3]`. What follows a hyphen is left off, so
 * `26.4-snapshot-3` counts as 26.4 — it is closer to that than to anything
 * else. A week-numbered snapshot (`25w14a`) or an old alpha says nothing about
 * where it stands among the releases, and gets null.
 */
export function releaseNumber(id: string): number[] | null {
  const numbers = id.split('-')[0].split('.');
  if (numbers.length < 2 || !numbers.every((part) => /^\d+$/.test(part))) return null;
  return numbers.map(Number);
}

/**
 * Whether a Minecraft version is `floor` or a later release — or null when
 * its id does not say where it stands.
 */
export function isReleaseAtLeast(id: string, floor: string): boolean | null {
  const version = releaseNumber(id);
  const least = releaseNumber(floor);
  if (!version || !least) return null;
  for (let i = 0; i < Math.max(version.length, least.length); i++) {
    const difference = (version[i] ?? 0) - (least[i] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}
