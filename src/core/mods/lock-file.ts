import fs from 'node:fs/promises';
import path from 'node:path';
import { paths } from '../config/paths';
import { writeJsonAtomic } from '../util/atomic-file';
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
  try {
    const raw = await fs.readFile(paths.profileLockFile(profileId), 'utf-8');
    return JSON.parse(raw) as InstalledMod[];
  } catch {
    return [];
  }
}

export async function writeLockFile(profileId: string, mods: InstalledMod[]): Promise<void> {
  await writeJsonAtomic(paths.profileLockFile(profileId), mods);
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
