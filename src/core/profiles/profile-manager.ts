import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Dirent } from 'node:fs';
import { log } from '../../main/logger';
import { paths } from '../config/paths';
import { writeJsonAtomic } from '../util/atomic-file';
import { profileSchema } from '../../shared/validators';
import { recommendedRamMb } from '../../shared/memory';
import { machineMemoryMb } from '../util/machine-memory';
import type { OrphanedProfile, Profile, ProfileFileSummary } from '../../shared/ipc-types';

// ── Profiles index persistence ─────────────────────────────

let cachedProfiles: Profile[] | null = null;

async function readProfilesIndex(): Promise<Profile[]> {
  if (cachedProfiles) return cachedProfiles;
  try {
    const raw = await fs.readFile(paths.profilesIndex, 'utf-8');
    const parsed = JSON.parse(raw) as Profile[];
    cachedProfiles = parsed;
    return parsed;
  } catch {
    cachedProfiles = [];
    return [];
  }
}

async function writeProfilesIndex(profiles: Profile[]): Promise<void> {
  cachedProfiles = profiles;
  await writeJsonAtomic(paths.profilesIndex, profiles);
}

/** The tail of the chain of in-flight mutations. */
let mutations: Promise<unknown> = Promise.resolve();

/**
 * Read `profiles.json`, change it, and write it back with nothing in between.
 *
 * Every mutation is a read-modify-write with `await`s inside it, and they were
 * running concurrently: a game exiting calls `recordPlaySession` at whatever
 * moment it exits, which is as likely as not to be while the user has an edit
 * in flight. Both read the same array, both write, and the second one to finish
 * wins — so the play time landed and the edit vanished, or the other way round,
 * with nothing to show that anything had been lost.
 *
 * Serializing them is enough because this process is the only writer. The queue
 * survives a rejected mutation: the next one still runs.
 */
async function mutateProfiles<T>(mutate: (profiles: Profile[]) => T | Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const profiles = [...(await readProfilesIndex())];
    const result = await mutate(profiles);
    await writeProfilesIndex(profiles);
    return result;
  };

  const started = mutations.then(run, run);
  mutations = started.then(
    () => undefined,
    () => undefined,
  );
  return started;
}

// ── Public API ─────────────────────────────────────────────

export async function getAllProfiles(): Promise<Profile[]> {
  return readProfilesIndex();
}

export async function getProfile(profileId: string): Promise<Profile | null> {
  const profiles = await readProfilesIndex();
  return profiles.find((p) => p.id === profileId) ?? null;
}

export async function createProfile(
  data: Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<Profile> {
  const now = new Date().toISOString();
  // The schema's output is what gets stored, not the caller's object: parsing
  // and then discarding the result would let unknown fields — from an import,
  // or from a newer build's profile — persist into profiles.json unexamined.
  const profile: Profile = profileSchema.parse({
    ...data,
    id: crypto.randomUUID(),
    // The last word on RAM for callers that express no preference — profile
    // import, and anything that grows a profile out of something other than the
    // form. A machine is under it to ask, so it is asked; only when it cannot
    // be measured does this land on the flat default.
    allocatedRamMb: data.allocatedRamMb ?? recommendedRamMb(machineMemoryMb()),
    createdAt: now,
    updatedAt: now,
  });

  await mutateProfiles((profiles) => profiles.push(profile));

  // Create profile directory
  await fs.mkdir(paths.profileDir(profile.id), { recursive: true });
  await fs.mkdir(paths.profileGameDir(profile.id), { recursive: true });

  log.info(`Created profile: ${profile.name} (${profile.id})`);
  return profile;
}

export async function updateProfile(
  profileId: string,
  updates: Partial<Profile>,
): Promise<Profile> {
  const merged = await mutateProfiles((profiles) => {
    const idx = profiles.findIndex((p) => p.id === profileId);
    if (idx < 0) throw new Error(`Profile ${profileId} not found`);

    const next: Profile = profileSchema.parse({
      ...profiles[idx],
      ...updates,
      id: profileId, // prevent id overwrite
      createdAt: profiles[idx].createdAt, // prevent createdAt overwrite
      updatedAt: new Date().toISOString(),
    });
    profiles[idx] = next;
    return next;
  });

  log.info(`Updated profile: ${merged.name} (${profileId})`);
  return merged;
}

/** Entries of one directory, or nothing when it was never created. */
async function listDir(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Total size of everything under a directory, following no symlinks.
 *
 * Every entry is walked at once rather than one `stat` at a time. A profile
 * with a few worlds in it holds tens of thousands of region and chunk files,
 * and the delete confirmation cannot open until this finishes — serially that
 * is a dialog that visibly hangs on exactly the profiles whose deletion is
 * worth thinking about.
 */
export async function directorySize(dir: string): Promise<number> {
  const sizes = await Promise.all(
    (await listDir(dir)).map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return directorySize(full);
      if (!entry.isFile()) return 0;
      try {
        return (await fs.stat(full)).size;
      } catch {
        /* vanished mid-walk — it is not going to be deleted either */
        return 0;
      }
    }),
  );
  return sizes.reduce((total, size) => total + size, 0);
}

/**
 * What a profile has on disk, for the delete confirmation to quote back.
 *
 * Counted from the directories rather than from the lock files: a jar dropped
 * into `mods/` by hand is in none of the indexes and is deleted all the same,
 * so counting the indexes would understate what is about to be lost. Worlds are
 * the reason this exists at all — they are the one thing in a profile that
 * cannot be reinstalled from anywhere.
 */
export async function summarizeProfileFiles(profileId: string): Promise<ProfileFileSummary> {
  const dir = paths.profileDir(profileId);
  const [mods, shaders, resourcePacks, saves] = await Promise.all([
    listDir(paths.profileModsDir(profileId)),
    listDir(paths.profileShadersDir(profileId)),
    listDir(paths.profileResourcePacksDir(profileId)),
    listDir(path.join(paths.profileGameDir(profileId), 'saves')),
  ]);

  return {
    mods: mods.filter((e) => e.isFile()).length,
    shaders: shaders.filter((e) => !e.name.startsWith('.')).length,
    resourcePacks: resourcePacks.filter((e) => !e.name.startsWith('.')).length,
    // A world is a directory; `saves/` holds nothing else worth counting.
    worlds: saves.filter((e) => e.isDirectory()).length,
    bytes: await directorySize(dir),
    path: dir,
  };
}

/**
 * Remove a profile from the launcher, and optionally everything it installed.
 *
 * The two are separate because they are not equally reversible. The profile
 * entry is a few lines of JSON that take a minute to retype; the directory holds
 * world saves, which are gone for good. Keeping the files leaves them at
 * `profiles/<id>/` — unreachable from the UI, but recoverable by hand, which is
 * the entire point of offering the choice.
 */
export async function deleteProfile(profileId: string, deleteFiles = true): Promise<void> {
  const removed = await mutateProfiles((profiles) => {
    const idx = profiles.findIndex((p) => p.id === profileId);
    if (idx < 0) throw new Error(`Profile ${profileId} not found`);
    return profiles.splice(idx, 1)[0];
  });
  const name = removed.name;

  if (deleteFiles) {
    try {
      await fs.rm(paths.profileDir(profileId), { recursive: true, force: true });
    } catch (err) {
      log.warn(`Failed to delete profile directory for ${profileId}: ${err}`);
    }
  } else {
    // Leave the profile's own record beside its files. Directories are named by
    // id, so without this the folder is an opaque UUID full of jars that nothing
    // — not the launcher, not the person who kept them — can identify later.
    await writeJsonAtomic(orphanRecordPath(profileId), removed);
    log.info(`Kept the files of profile ${name} at ${paths.profileDir(profileId)}`);
  }

  log.info(`Deleted profile: ${name} (${profileId})`);
}

/** Where a kept-behind profile leaves its identity. */
function orphanRecordPath(profileId: string): string {
  return path.join(paths.profileDir(profileId), 'profile.json');
}

/**
 * Profile data left on disk that no profile in the index points at.
 *
 * The counterpart to "delete, keep files". Directories are keyed by id, never by
 * name, so keeping the files and then making a new profile called the same thing
 * collides with nothing — the new one gets a new id and an empty directory of its
 * own. That is safe, and it is also the problem: the kept files become
 * unreachable, and the only place their path was ever shown was a dialog that has
 * since closed. Listing them is what makes keeping them a real offer.
 */
export async function listOrphanedProfiles(): Promise<OrphanedProfile[]> {
  const known = new Set((await readProfilesIndex()).map((p) => p.id));
  const orphans: OrphanedProfile[] = [];

  for (const entry of await listDir(paths.profilesDir)) {
    if (!entry.isDirectory() || known.has(entry.name)) continue;
    try {
      const raw = await fs.readFile(orphanRecordPath(entry.name), 'utf-8');
      const profile = profileSchema.parse(JSON.parse(raw));
      orphans.push({ profile, files: await summarizeProfileFiles(entry.name) });
    } catch {
      // No record, or an unreadable one. A directory the launcher cannot
      // identify is not something to offer restoring — leave it alone rather
      // than inviting anyone to act on a guess about what it holds.
    }
  }

  return orphans;
}

/**
 * Put kept-behind data back on the profile list, under its original id.
 *
 * The id is the whole point: it is what ties a profile to its directory, so
 * restoring under a fresh one would produce an empty profile beside the files it
 * was supposed to recover.
 */
export async function adoptOrphanedProfile(profileId: string): Promise<Profile> {
  const raw = await fs.readFile(orphanRecordPath(profileId), 'utf-8');
  const restored: Profile = {
    ...profileSchema.parse(JSON.parse(raw)),
    id: profileId,
    updatedAt: new Date().toISOString(),
  };

  await mutateProfiles((profiles) => {
    if (profiles.some((p) => p.id === profileId)) {
      throw new Error(`Profile ${profileId} is already on the list`);
    }
    profiles.push(restored);
  });
  await fs.rm(orphanRecordPath(profileId), { force: true });
  log.info(`Restored profile ${restored.name} (${profileId}) from kept files`);
  return restored;
}

/** Delete kept-behind data for good. */
export async function discardOrphanedProfile(profileId: string): Promise<void> {
  const profiles = await readProfilesIndex();
  if (profiles.some((p) => p.id === profileId)) {
    throw new Error(`${profileId} belongs to a live profile, not to kept files`);
  }
  await fs.rm(paths.profileDir(profileId), { recursive: true, force: true });
  log.info(`Discarded kept files for ${profileId}`);
}

/**
 * Fold one finished session into the profile's play statistics.
 *
 * Deliberately not `updateProfile()`: that stamps `updatedAt`, which the UI
 * reads as "you edited this profile". Playing is not editing.
 */
export async function recordPlaySession(profileId: string, playTimeMinutes: number): Promise<void> {
  await mutateProfiles((profiles) => {
    const idx = profiles.findIndex((p) => p.id === profileId);
    if (idx < 0) return;

    profiles[idx] = {
      ...profiles[idx],
      lastPlayed: new Date().toISOString(),
      totalPlayTimeMinutes:
        (profiles[idx].totalPlayTimeMinutes ?? 0) + Math.max(0, playTimeMinutes),
    };
  });
}

/**
 * Copy a profile, under a name the caller chooses.
 *
 * The name is a parameter because it is *persisted*. It used to be built here
 * as `${name} (kopia)` — Polish, baked into `profiles.json`, where switching
 * the launcher to English would never fix it, because by then it is the
 * profile's actual name. The renderer knows the language and supplies it; the
 * English fallback is for a programmatic call with nothing to say.
 */
export async function duplicateProfile(profileId: string, name?: string): Promise<Profile> {
  const source = await getProfile(profileId);
  if (!source) throw new Error(`Profile ${profileId} not found`);

  const { id: _id, createdAt: _ca, updatedAt: _ua, ...data } = source;
  return createProfile({
    ...data,
    name: name?.trim() || `${source.name} (copy)`,
    lastPlayed: undefined,
    totalPlayTimeMinutes: undefined,
  });
}

export async function exportProfile(profileId: string): Promise<string> {
  const profile = await getProfile(profileId);
  if (!profile) throw new Error(`Profile ${profileId} not found`);
  return JSON.stringify(profile, null, 2);
}

/**
 * Fields an imported profile never keeps.
 *
 * A profile export is a file that gets passed around — posted in a Discord
 * channel, attached to a forum reply — and three of its fields reach a process
 * the next time it launches:
 *
 * - `customJavaPath` chooses the binary `spawn` runs;
 * - `javaArgs` is split straight into the JVM's own argument list, and JVM
 *   arguments are an execution surface in their own right — `-XX:OnOutOfMemoryError=…`
 *   and `-XX:OnError=…` run a shell command, `-javaagent`/`-agentpath` load code
 *   at startup — so a token with no whitespace in it (a literal `$IFS` does the
 *   rest) is a command the moment the game OOMs or crashes, which a modded
 *   instance does routinely.
 * - `manifestUrl` makes the profile *follow a pack*: every launch re-syncs it,
 *   installing and running whatever mods that address lists. With no trusted key
 *   configured — the default — an unsigned third-party manifest is accepted, so
 *   an imported file could quietly subscribe the importer to a mod source of the
 *   sender's choosing and run its jars, which are host code in every sense a
 *   `-javaagent` is.
 *
 * All three make an innocuous-looking "here's my profile" attachment a way to
 * run what the sender likes on the machine that opens it, with no step at which
 * anyone is asked. They stay available as features — set by the person at the
 * keyboard, in the editor or by re-adding the pack from the catalogue, where the
 * source is shown — rather than arriving inside a file. That is the difference
 * between configuring a hook and receiving one.
 *
 * Only fields the schema declares can get this far, so this list needs an entry
 * only for the ones the launcher does honour. A field it has never heard of —
 * or no longer has — is dropped by the parse below without being named here.
 */
const NOT_IMPORTED = ['customJavaPath', 'javaArgs', 'manifestUrl'] as const;

/** A profile export, reduced to what may safely be turned into a new profile. */
export interface ImportedProfile {
  data: Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>;
  /** Fields the file carried that an import must not silently honour. */
  dropped: string[];
}

/**
 * Read a profile export into something `createProfile` may be given.
 *
 * Pure, so the rule above can be pinned by a test without a filesystem.
 */
export function readImportedProfile(json: string): ImportedProfile {
  const raw: unknown = JSON.parse(json);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('That file does not contain a profile');
  }

  const dropped = NOT_IMPORTED.filter((field) => (raw as Record<string, unknown>)[field]);

  // Validated against the schema before anything is built from it, and the
  // schema's *output* is what is used — parsing and then keeping the original
  // object would let fields nothing knows about ride along into profiles.json.
  // The three the launcher assigns itself are optional here: an export carries
  // them, and a profile pasted together by hand need not.
  const parsed = profileSchema
    .partial({ id: true, createdAt: true, updatedAt: true })
    .safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      'That file is not a valid profile — ' +
        parsed.error.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join('; '),
    );
  }

  const {
    id: _id,
    createdAt: _ca,
    updatedAt: _ua,
    lastPlayed: _lp,
    totalPlayTimeMinutes: _tp,
    customJavaPath: _java,
    javaArgs: _jargs,
    manifestUrl: _murl,
    ...data
  } = parsed.data;

  return { data, dropped };
}

export async function importProfile(json: string): Promise<Profile> {
  const { data, dropped } = readImportedProfile(json);
  if (dropped.length > 0) {
    log.warn(`Dropped ${dropped.join(' and ')} while importing profile ${data.name}`);
  }
  return createProfile(data);
}
