import { expectedHash, type HashedEntry } from './integrity';

/**
 * When a pack's config override replaces the file already on disk.
 *
 * A pack ships config overrides so that a profile starts out configured — the
 * server's view distance, the keybinds a mod needs, `options.txt`. The question
 * every sync has to answer is what to do when the file on disk no longer
 * matches: the pack changed it, or the player did.
 *
 * Hashing the file cannot tell those apart, and answering "the pack" meant
 * `options.txt` was restored after every sync. Minecraft rewrites that file on
 * exit, so the mismatch was guaranteed from the first session onwards, and a
 * player lost their volume, their FOV and their keybinds to every mod update in
 * the pack — for settings the pack only ever meant as a starting point.
 *
 * Recording what was last delivered answers it properly. The pack's version of
 * a file has an identity, and a sync applies the file exactly when that
 * identity is one the profile has not been given yet. An update the author made
 * still lands; an edit the player made is left alone.
 */
export function configVersion(config: HashedEntry): string | null {
  const hash = expectedHash(config);
  return hash ? `${hash.algorithm}:${hash.value}` : null;
}

export function shouldApplyConfigOverride(
  config: HashedEntry,
  lastApplied: string | undefined,
  fileExists: boolean,
): boolean {
  // Nothing to preserve, and a profile missing a file the pack promised is the
  // case this whole mechanism exists for.
  if (!fileExists) return true;

  // Without a hash there is no identity to compare, so there is no way to tell
  // an author's update from a player's edit. Deliver it, which is what the
  // manifest asked for and what every sync did before records existed.
  const version = configVersion(config);
  if (version === null) return true;

  return version !== lastApplied;
}
