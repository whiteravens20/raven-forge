// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from '../../main/logger';
import { paths } from '../config/paths';
import { writeJsonAtomic } from '../util/atomic-file';
import { getProfile, directorySize } from './profile-manager';
import type { WorldBackup, WorldBackupReason } from '../../shared/ipc-types';

/**
 * Copies of a profile's worlds, taken before the launcher does something it
 * cannot take back.
 *
 * Everything else in a profile downloads again. A world does not, and the most
 * dangerous button the UI offers — changing a profile's Minecraft version with
 * mods installed — had no guard of any kind: the mods stay, the version moves,
 * and the next launch either fails or opens the world in a newer format that
 * the old version will not read afterwards.
 *
 * A backup is a plain directory copy rather than an archive. Worlds are made of
 * region files that are already compressed, so zipping buys almost nothing and
 * costs the one thing that matters when a restore is needed: being able to look
 * inside and copy a folder out by hand.
 *
 * This protects against the launcher, not against the disk. The copy sits
 * inside the profile, so it goes when the profile goes, and a failing drive
 * takes both. Anyone who needs more than that needs a backup off the machine.
 */

/** How many automatic backups to keep. Manual ones are never pruned. */
const KEEP_AUTOMATIC = 5;

/**
 * A backup's id is also its directory name, so it may contain nothing Windows
 * refuses — which rules out the colons an ISO timestamp is full of.
 *
 * Milliseconds are in it because seconds are not enough. Taking a backup and
 * then restoring it happens inside one second easily, and the safety copy that
 * restore takes would land on the id of the backup being restored: same
 * directory, `fs.cp` merging the current worlds into it, and the restore then
 * reading back a mixture of both. Two backups cannot share a name.
 */
const ID_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}$/;

function newBackupId(when: Date): string {
  return when.toISOString().replace(/[:.]/g, '-').slice(0, 23);
}

/** Ids cross IPC, so one is checked rather than trusted before it becomes a path. */
function backupDir(profileId: string, backupId: string): string {
  if (!ID_PATTERN.test(backupId)) throw new Error(`Not a backup id: ${backupId}`);
  return path.join(paths.profileBackupsDir(profileId), backupId);
}

async function savesDirFor(profileId: string): Promise<string> {
  const profile = await getProfile(profileId);
  if (!profile) throw new Error(`Profile ${profileId} not found`);
  return path.join(paths.profileGameDir(profile.id), 'saves');
}

/** World folder names in a `saves/` directory; `[]` when there is no such thing. */
async function worldsIn(savesDir: string): Promise<string[]> {
  try {
    return (await fs.readdir(savesDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * What `backup.json` says about the copy it sits beside.
 *
 * The size is in it because the copy does not change, and finding it out means
 * a `stat` of every region file of every world in it. It used to be found out
 * again each time the list was shown — once per backup, on every visit to the
 * profile, and once more whenever an old copy was to be pruned.
 */
interface BackupRecord {
  createdAt: string;
  reason: WorldBackupReason;
  worlds: string[];
  bytes?: number;
}

/** What this profile has that would be worth keeping. */
export async function listWorlds(profileId: string): Promise<string[]> {
  return worldsIn(await savesDirFor(profileId));
}

/** Every backup this profile holds, newest first. */
export async function listBackups(profileId: string): Promise<WorldBackup[]> {
  const root = paths.profileBackupsDir(profileId);

  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const backups = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && ID_PATTERN.test(entry.name))
      .map(async (entry): Promise<WorldBackup | null> => {
        const dir = path.join(root, entry.name);
        try {
          const record = path.join(dir, 'backup.json');
          const meta = JSON.parse(await fs.readFile(record, 'utf-8')) as BackupRecord;
          if (typeof meta.bytes === 'number') return { id: entry.name, ...meta, bytes: meta.bytes };

          // A backup from before the size was written down. Measured this once
          // and noted, so that it is not measured again at every look.
          const bytes = await directorySize(path.join(dir, 'saves'));
          await writeJsonAtomic(record, { ...meta, bytes }).catch(() => undefined);
          return { id: entry.name, ...meta, bytes };
        } catch {
          // A directory with no readable record is a half-written backup from a
          // crash. Listing it would offer a restore that cannot work.
          log.warn(`Ignoring backup ${entry.name} of profile ${profileId}: no usable record`);
          return null;
        }
      }),
  );

  return backups
    .filter((backup): backup is WorldBackup => backup !== null)
    .sort((a, b) => b.id.localeCompare(a.id));
}

/**
 * Delete all but the newest few automatic backups.
 *
 * Without this every version change leaves another full copy of every world
 * behind, and a profile quietly grows without anybody choosing that. A manual
 * backup is somebody's decision and is never touched.
 *
 * Neither is anything named in `keep`, however old it sorts. Age alone used to
 * decide, and age is the id, which is whatever the clock said. Restoring the
 * oldest of five automatic copies pruned the very one being restored; and with
 * the clock set back, the copy just taken sorted oldest and went the moment it
 * was made.
 *
 * Never throws. This is housekeeping after something that has already worked,
 * and an old copy that will not go — a file in it held open, on Windows — must
 * not turn a restore that put the worlds back into one that reports failure.
 * Whatever stays is past keeping the next time as well, and is tried again.
 */
async function pruneAutomatic(profileId: string, keep: string[]): Promise<void> {
  const automatic = (await listBackups(profileId)).filter((b) => b.reason !== 'manual');
  for (const stale of automatic.slice(KEEP_AUTOMATIC)) {
    if (keep.includes(stale.id)) continue;
    try {
      await fs.rm(backupDir(profileId, stale.id), { recursive: true, force: true });
      log.info(`Pruned automatic world backup ${stale.id} of profile ${profileId}`);
    } catch (err) {
      log.warn(`Could not prune world backup ${stale.id} of profile ${profileId}:`, err);
    }
  }
}

/**
 * Copy this profile's worlds aside.
 *
 * Refuses when there is nothing to copy rather than producing an empty backup:
 * an entry in the list that restores nothing is worse than no entry at all.
 */
export async function backupWorlds(
  profileId: string,
  reason: WorldBackupReason = 'manual',
): Promise<WorldBackup> {
  const backup = await copyWorldsAside(profileId, reason);
  if (reason !== 'manual') await pruneAutomatic(profileId, [backup.id]);
  return backup;
}

/**
 * The copy itself, and nothing else: no older backup is touched from here.
 *
 * Apart from `backupWorlds` so that a restore can take its safety copy without
 * pruning in the same breath — see `restoreBackup`.
 */
async function copyWorldsAside(profileId: string, reason: WorldBackupReason): Promise<WorldBackup> {
  const savesDir = await savesDirFor(profileId);
  const worlds = await worldsIn(savesDir);
  if (worlds.length === 0) throw new Error('This profile has no worlds to back up.');

  const createdAt = new Date();
  const id = newBackupId(createdAt);
  const dir = backupDir(profileId, id);
  // The parent recursively, the backup itself not: an `EEXIST` here is a name
  // collision, and the only safe answer is to fail rather than write into
  // somebody else's backup.
  await fs.mkdir(path.dirname(dir), { recursive: true });
  await fs.mkdir(dir);

  let bytes: number;
  try {
    // Symlinks are copied as symlinks, not followed. A link in `saves/` points
    // outside the profile as often as not, and a backup that silently swallowed
    // whatever it aimed at would be a surprise in both directions.
    await fs.cp(savesDir, path.join(dir, 'saves'), { recursive: true });
    bytes = await directorySize(path.join(dir, 'saves'));
    const record: BackupRecord = { createdAt: createdAt.toISOString(), reason, worlds, bytes };
    await writeJsonAtomic(path.join(dir, 'backup.json'), record);
  } catch (err) {
    // A partial copy that lists as a backup is the one outcome worth avoiding
    // entirely — it would be offered as a restore.
    await fs.rm(dir, { recursive: true, force: true });
    throw err;
  }

  log.info(`Backed up ${worlds.length} world(s) of profile ${profileId} as ${id} (${reason})`);
  return {
    id,
    createdAt: createdAt.toISOString(),
    reason,
    worlds,
    bytes,
  };
}

/**
 * Put a backup's worlds back, replacing what is in `saves/` now.
 *
 * Whatever is being replaced is copied aside first, and that copy is made
 * *before* anything is deleted — so a restore chosen by mistake is itself
 * undoable, and a failure part-way through has left the originals somewhere.
 *
 * Nothing is pruned until the worlds are back. The safety copy is an automatic
 * backup like any other, and taking it used to prune on the spot: restoring the
 * oldest of five deleted that very backup, then `saves/`, and then failed for
 * want of anything to copy. Until the copy back has finished, the backup being
 * restored and the safety copy are the only two places the worlds exist.
 *
 * @returns the safety copy taken, or null when there was nothing to save
 */
export async function restoreBackup(
  profileId: string,
  backupId: string,
): Promise<WorldBackup | null> {
  const dir = backupDir(profileId, backupId);
  const source = path.join(dir, 'saves');
  if ((await worldsIn(source)).length === 0) {
    throw new Error('That backup holds no worlds — it may have been deleted or is incomplete.');
  }

  const savesDir = await savesDirFor(profileId);
  const existing = await worldsIn(savesDir);
  const safety = existing.length > 0 ? await copyWorldsAside(profileId, 'before-restore') : null;

  await fs.rm(savesDir, { recursive: true, force: true });
  await fs.cp(source, savesDir, { recursive: true });

  log.info(`Restored world backup ${backupId} into profile ${profileId}`);

  // The backup just restored stays even when it is the oldest: it was asked for
  // by name a moment ago, and a list it has vanished from reads as a restore
  // that used it up.
  if (safety) await pruneAutomatic(profileId, [backupId, safety.id]);
  return safety;
}

export async function deleteBackup(profileId: string, backupId: string): Promise<void> {
  await fs.rm(backupDir(profileId, backupId), { recursive: true, force: true });
  log.info(`Deleted world backup ${backupId} of profile ${profileId}`);
}
