import type { ModEntry } from '../../shared/manifest-schema';
import type { InstalledMod } from '../../shared/ipc-types';

/**
 * How many mods a sync would add, change or remove.
 *
 * The profile's badge used to be written only at the end of a sync, so
 * "Synced" meant "the last sync finished", not "this profile matches the pack".
 * A pack that moved twice since left the badge green and said nothing, and
 * nothing else would have said it either: launching a profile installs the
 * loader, Java and the client jar, but never reconciles mods. The player's only
 * hint that they were a version behind was pressing Sync and watching.
 *
 * Counting the difference is what lets the badge answer the question it appears
 * to answer. It is deliberately the same number a sync would act on, so the
 * badge and the button never disagree.
 */
export function pendingChanges(manifestMods: ModEntry[], installed: InstalledMod[]): number {
  // Server-only entries are never installed into a player's profile, so they
  // are not something the profile can be behind on.
  const wanted = manifestMods.filter((m) => m.side === 'client' || m.side === 'both');
  const have = new Map(installed.map((m) => [m.id, m]));

  let changes = 0;
  for (const entry of wanted) {
    const current = have.get(entry.id);
    // Version, not hash: it is what a sync records, so after a successful sync
    // of this manifest the two agree exactly and the count settles at zero.
    if (!current || current.version !== entry.version) changes++;
  }

  // Mods this pack no longer ships. Only the ones the pack put there — a mod
  // the player installed by hand is theirs to keep, and a sync leaves it alone.
  const keep = new Set(wanted.map((m) => m.id));
  for (const mod of installed) {
    if (mod.fromManifest && !keep.has(mod.id)) changes++;
  }

  return changes;
}
