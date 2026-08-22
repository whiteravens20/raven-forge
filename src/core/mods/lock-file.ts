import fs from 'node:fs/promises';
import path from 'node:path';
import { paths } from '../config/paths';
import { writeJsonAtomic } from '../util/atomic-file';
import { serializeByKey } from '../util/serialize';
import type { InstalledMod } from '../../shared/ipc-types';

/**
 * `installed.lock` — what a profile's `mods/` directory is supposed to contain.
 *
 * Read and written by the manifest sync, by hand-installs from the Modrinth
 * browser and by the update check, which is why it lives on its own: all three
 * have to agree on where a jar is and what identifies it, and a second copy of
 * these four functions is a second set of rules to keep in step.
 */

export async function readLockFile(profileId: string): Promise<InstalledMod[]> {
  // Resolved outside the `try`, deliberately. A file that is absent or will not
  // parse means "nothing installed" and is a normal state; an id that is not a
  // path component means somebody sent one that was never a profile, and
  // answering that with an empty list would hide it behind a plausible reply.
  const file = paths.profileLockFile(profileId);
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8')) as InstalledMod[];
  } catch {
    return [];
  }
}

async function writeLockFile(profileId: string, mods: InstalledMod[]): Promise<void> {
  await writeJsonAtomic(paths.profileLockFile(profileId), mods);
}

/**
 * Read `installed.lock`, change it, and write it back with nothing in between.
 *
 * The counterpart to `mutateProfiles`, and absent for exactly as long as this
 * file has existed. Every writer here is a read-modify-write with `await`s in
 * the middle — a download, a hash, a round trip to Modrinth — and they overlap
 * in ordinary use: a pack sync running while the player installs a mod by hand,
 * or an update check finishing after a toggle.
 *
 * Losing one of the two writes was not the worst of it. `writeFileAtomic` named
 * its temporary file after the process id alone, so two writes from *this*
 * process opened the same temporary file and interleaved their bytes into it
 * before renaming the result into place — and a lock file that will not parse
 * reads as "nothing installed", with every jar still sitting in `mods/`.
 *
 * The array handed to `mutate` is the current contents and is written back
 * afterwards; mutate it in place, as with `mutateProfiles`.
 */
export function mutateLockFile<T>(
  profileId: string,
  mutate: (mods: InstalledMod[]) => T | Promise<T>,
): Promise<T> {
  return serializeByKey(paths.profileLockFile(profileId), async () => {
    const mods = await readLockFile(profileId);
    const result = await mutate(mods);
    await writeLockFile(profileId, mods);
    return result;
  });
}

/**
 * Where a mod's jar sits, which depends on whether it is switched on.
 *
 * Switching a mod off renames its file rather than deleting it, so every piece
 * of code that goes looking for one has to ask the lock file first. Nothing did
 * during a sync, and the cost was quiet: the check looked for `<name>.jar`,
 * found only `<name>.jar.disabled`, called the mod missing and downloaded it
 * again — leaving both files in `mods/`. The game loads by extension, so a mod
 * the launcher showed as off was loaded anyway, on every sync, for as long as
 * the profile followed a pack.
 */
export function modFilePath(modsDir: string, fileName: string, enabled: boolean): string {
  return path.join(modsDir, enabled ? fileName : `${fileName}.disabled`);
}
