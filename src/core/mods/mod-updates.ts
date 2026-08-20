import path from 'node:path';
import { log } from '../../main/logger';
import { paths } from '../config/paths';
import { acceptedLoaders } from '../../shared/constants';
import { getProfile } from '../profiles/profile-manager';
import { hashFile } from './integrity';
import { readLockFile, writeLockFile, modFilePath } from './lock-file';
import { getProjectTitle, getVersion, latestVersionsByHash, primaryFile } from './modrinth-api';
import { downloadFor, installResolvedMod, installRequiredDependencies } from './mod-sync';
import type { InstalledMod, ModUpdateResult, ModUpdateSummary } from '../../shared/ipc-types';

/**
 * Keeping hand-installed mods current.
 *
 * A profile that follows a manifest has this already — the sync is the update
 * mechanism. A mod picked out of the Modrinth browser, or a jar dropped into
 * `mods/` by hand, had nothing: it stayed at the build it arrived as until
 * somebody noticed and reinstalled it.
 *
 * Mods are identified by hashing the jar rather than by what `installed.lock`
 * says they are. That costs a read of every file, and buys two things worth
 * more than the read: a hand-dropped jar with no project id is recognised all
 * the same, and "is there something newer" is answered by comparing bytes
 * instead of version strings, which are a publisher's free text and agree on
 * nothing across projects.
 */

/**
 * Which mods the launcher is free to move, and where their jars are.
 *
 * A manifest's mods belong to the pack: bumping one behind the pack's back is
 * how a profile quietly stops matching the server it plays on, and the sync
 * would put it back on the next run anyway. A disabled mod is not loaded by the
 * game at all, so there is nothing about it to keep current.
 */
function updatable(mods: InstalledMod[], modsDir: string): Array<[InstalledMod, string]> {
  return mods
    .filter((mod) => !mod.fromManifest && mod.enabled)
    .map((mod) => [mod, modFilePath(modsDir, mod.fileName, mod.enabled)] as [InstalledMod, string]);
}

/**
 * Ask Modrinth what each installed jar is and whether anything has superseded
 * it, and record the answer in `installed.lock`.
 *
 * Writing it down is what lets the list show a badge without going back to the
 * network every time the page is opened, and what lets the update itself
 * install the exact build the badge was about.
 */
export async function checkModUpdates(profileId: string): Promise<ModUpdateSummary> {
  const profile = await getProfile(profileId);
  if (!profile) throw new Error(`Profile ${profileId} not found`);

  const mods = await readLockFile(profileId);
  // Cleared up front rather than only where a newer build turns up: a mod that
  // has since been updated by hand, disabled, or adopted by a manifest would
  // otherwise keep offering an update that no longer exists.
  for (const mod of mods) delete mod.updateAvailable;

  const modsDir = paths.profileModsDir(profileId);
  const byHash = new Map<string, InstalledMod>();
  for (const [mod, file] of updatable(mods, modsDir)) {
    try {
      byHash.set(await hashFile(file, 'sha512'), mod);
    } catch {
      // The jar named by the lock file is not there. That is a repair job for
      // the sync, not a reason to fail a check about the rest of the profile.
      log.warn(`Skipping ${mod.name} in the update check: ${path.basename(file)} is missing`);
    }
  }

  const latest = await latestVersionsByHash(
    [...byHash.keys()],
    acceptedLoaders(profile.modLoader),
    [profile.minecraftVersion],
  );

  let updates = 0;
  for (const [hash, mod] of byHash) {
    const newest = latest.get(hash);
    // The reply is the newest build that fits the profile, which is usually the
    // one already installed. Same bytes, same hash — so the file that was sent
    // turning up in the answer means there is nothing to do.
    if (!newest || newest.files.some((f) => f.hashes.sha512 === hash)) continue;

    mod.updateAvailable = {
      versionId: newest.id,
      versionNumber: newest.version_number || newest.id,
      projectId: newest.project_id,
    };
    updates++;
  }

  await writeLockFile(profileId, mods);
  log.info(
    `Update check for profile ${profileId}: ${updates} of ${byHash.size} mods have a newer build`,
  );

  return { checked: byHash.size, updates, unknown: byHash.size - latest.size };
}

/**
 * Install the builds a previous check found, in the order asked for.
 *
 * One mod failing does not stop the rest. A profile with twenty updates and one
 * project that has pulled its file should end up nineteen updates better off
 * and be told which one did not land, rather than stopping at whichever failed
 * first and leaving the player to guess how far it got.
 */
export async function updateMods(profileId: string, modIds: string[]): Promise<ModUpdateResult> {
  const updated: string[] = [];
  const failed: ModUpdateResult['failed'] = [];

  for (const modId of modIds) {
    // Re-read per mod: every install rewrites the lock file, so a list read once
    // at the top would be acting on a file that has since moved on.
    const mods = await readLockFile(profileId);
    const mod = mods.find((m) => m.id === modId);
    if (!mod?.updateAvailable) continue;
    const update = mod.updateAvailable;

    try {
      const version = await getVersion(update.versionId);
      // Pinned by id, so the build installed is the one the player was offered
      // and not whatever became newest in the meantime. Fetching it also proves
      // the file still exists before the old one is touched.
      primaryFile(version);

      // A mod already installed from Modrinth carries the project's own title;
      // one recognised by its hash carries a file name, and this is the moment
      // its real name is known.
      const name =
        mod.source === 'modrinth'
          ? mod.name
          : await getProjectTitle(update.projectId).catch(() => mod.name);

      await installResolvedMod(
        profileId,
        { id: update.projectId, name, source: 'modrinth' },
        downloadFor(version),
        mod.id,
      );
      // A new build may want something the old one did not — a split-off API, a
      // library that used to be bundled. Installing without them is the failure
      // mode this whole feature is supposed to prevent.
      await installRequiredDependencies(profileId, version);

      updated.push(name);
      log.info(`Updated ${name} to ${update.versionNumber} in profile ${profileId}`);
    } catch (err) {
      failed.push({ name: mod.name, error: err instanceof Error ? err.message : String(err) });
      log.warn(`Failed to update ${mod.name} in profile ${profileId}: ${err}`);
    }
  }

  return { updated, failed };
}
