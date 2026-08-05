import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { log } from '../../main/logger';
import { paths } from '../config/paths';
import { profileSchema } from '../../shared/validators';
import { DEFAULT_RAM_MB } from '../../shared/constants';
import type { Profile } from '../../shared/ipc-types';

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
  await fs.writeFile(paths.profilesIndex, JSON.stringify(profiles, null, 2), 'utf-8');
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
  const profile: Profile = {
    ...data,
    id: crypto.randomUUID(),
    allocatedRamMb: data.allocatedRamMb ?? DEFAULT_RAM_MB,
    createdAt: now,
    updatedAt: now,
  };

  // Validate
  profileSchema.parse(profile);

  const profiles = await readProfilesIndex();
  profiles.push(profile);
  await writeProfilesIndex(profiles);

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
  const profiles = await readProfilesIndex();
  const idx = profiles.findIndex((p) => p.id === profileId);
  if (idx < 0) throw new Error(`Profile ${profileId} not found`);

  const merged: Profile = {
    ...profiles[idx],
    ...updates,
    id: profileId, // prevent id overwrite
    createdAt: profiles[idx].createdAt, // prevent createdAt overwrite
    updatedAt: new Date().toISOString(),
  };

  profileSchema.parse(merged);
  profiles[idx] = merged;
  await writeProfilesIndex(profiles);

  log.info(`Updated profile: ${merged.name} (${profileId})`);
  return merged;
}

export async function deleteProfile(profileId: string): Promise<void> {
  const profiles = await readProfilesIndex();
  const idx = profiles.findIndex((p) => p.id === profileId);
  if (idx < 0) throw new Error(`Profile ${profileId} not found`);

  const name = profiles[idx].name;
  profiles.splice(idx, 1);
  await writeProfilesIndex(profiles);

  // Remove profile directory
  try {
    await fs.rm(paths.profileDir(profileId), { recursive: true, force: true });
  } catch (err) {
    log.warn(`Failed to delete profile directory for ${profileId}: ${err}`);
  }

  log.info(`Deleted profile: ${name} (${profileId})`);
}

/**
 * Fold one finished session into the profile's play statistics.
 *
 * Deliberately not `updateProfile()`: that stamps `updatedAt`, which the UI
 * reads as "you edited this profile". Playing is not editing.
 */
export async function recordPlaySession(profileId: string, playTimeMinutes: number): Promise<void> {
  const profiles = await readProfilesIndex();
  const idx = profiles.findIndex((p) => p.id === profileId);
  if (idx < 0) return;

  profiles[idx] = {
    ...profiles[idx],
    lastPlayed: new Date().toISOString(),
    totalPlayTimeMinutes: (profiles[idx].totalPlayTimeMinutes ?? 0) + Math.max(0, playTimeMinutes),
  };
  await writeProfilesIndex(profiles);
}

export async function duplicateProfile(profileId: string): Promise<Profile> {
  const source = await getProfile(profileId);
  if (!source) throw new Error(`Profile ${profileId} not found`);

  const { id: _id, createdAt: _ca, updatedAt: _ua, ...data } = source;
  return createProfile({
    ...data,
    name: `${source.name} (kopia)`,
    lastPlayed: undefined,
    totalPlayTimeMinutes: undefined,
  });
}

export async function exportProfile(profileId: string): Promise<string> {
  const profile = await getProfile(profileId);
  if (!profile) throw new Error(`Profile ${profileId} not found`);
  return JSON.stringify(profile, null, 2);
}

export async function importProfile(json: string): Promise<Profile> {
  const parsed = JSON.parse(json) as Profile;

  // Create as new profile (new ID, timestamps)
  const {
    id: _id,
    createdAt: _ca,
    updatedAt: _ua,
    lastPlayed: _lp,
    totalPlayTimeMinutes: _tp,
    ...data
  } = parsed;
  return createProfile(data);
}
