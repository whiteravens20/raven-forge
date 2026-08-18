// A profile: what it targets, what it has played, what it owns on disk.
// Part of the IPC contract — see `../ipc-types.ts`.

export type ModLoaderType = 'vanilla' | 'forge' | 'neoforge' | 'fabric' | 'quilt';

/** A mod loader build offered for a given Minecraft version. */
export interface LoaderVersion {
  version: string;
  stable: boolean;
}

export interface Profile {
  id: string;
  name: string;
  /** Absolute path to a user-supplied image, copied into the profile directory. */
  iconPath?: string;
  iconUrl?: string;
  /** Id of one of the launcher's built-in avatars, e.g. `raven`. */
  iconPreset?: string;
  minecraftVersion: string;
  modLoader: ModLoaderType;
  modLoaderVersion?: string;
  manifestUrl?: string;
  serverIp?: string;
  serverPort?: number;
  javaArgs?: string;
  allocatedRamMb: number;
  customJavaPath?: string;
  windowWidth?: number;
  windowHeight?: number;
  fullscreen?: boolean;
  gameDirectory?: string;
  preLaunchCommand?: string;
  notes?: string;
  lastPlayed?: string;
  totalPlayTimeMinutes?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileSyncStatus {
  profileId: string;
  lastSyncedAt?: string;
  manifestEtag?: string;
  pendingUpdates: number;
  status: 'synced' | 'updates-available' | 'error' | 'never-synced';
  errorMessage?: string;
}

/**
 * What a profile owns on disk, so deleting it can say what that costs.
 *
 * Counted from the directories, so hand-added files are included. `worlds` is
 * the number that matters — mods and packs download again, saves do not.
 */
export interface ProfileFileSummary {
  mods: number;
  shaders: number;
  resourcePacks: number;
  worlds: number;
  bytes: number;
  /** Where the files are, so keeping them is an offer with an address. */
  path: string;
}

/**
 * A profile's files, still on disk, with no profile pointing at them.
 *
 * Produced by "delete, keep files". Profile directories are keyed by id, so a
 * later profile of the same name never collides with these — it gets its own id
 * and its own empty directory. Which is exactly why they need listing: nothing
 * else would ever lead back to them.
 */
export interface OrphanedProfile {
  profile: Profile;
  files: ProfileFileSummary;
}

/**
 * What exporting a profile as a `.mrpack` produced.
 *
 * The counts are the point: a pack is references, not jars, so the difference
 * between `files` and `bundled` is the difference between a 20 KB file anyone
 * can install and a 300 MB one carrying somebody's hand-built mods. Reporting
 * both is what lets the player see which they got, and why.
 */
export interface MrpackExport {
  path: string;
  /** Entries the recipient downloads from Modrinth. */
  files: number;
  /** Files carried inside the archive because Modrinth does not host them. */
  bundled: number;
  bundledBytes: number;
  /** Config files and `options.txt` carried along in `overrides/`. */
  overrides: number;
  /** Content left out because it is switched off in the profile. */
  skippedDisabled: number;
}

/**
 * A copy of a profile's `saves/` directory, taken at a point in time.
 *
 * Worlds are the one thing in a profile that exists nowhere else — mods and
 * packs download again, a world does not — and until this the launcher would
 * happily change a profile's Minecraft version underneath one.
 */
export interface WorldBackup {
  /** The directory it lives in: a timestamp, which also orders them. */
  id: string;
  createdAt: string;
  /** Why it was taken. Automatic ones are pruned; a manual one is never touched. */
  reason: WorldBackupReason;
  /** World folder names, so a backup can be recognised without opening it. */
  worlds: string[];
  bytes: number;
}

/**
 * `manual` is a player pressing the button. The other two are the launcher
 * protecting itself: before a Minecraft version change, and before a restore
 * overwrites whatever is in `saves/` now.
 */
export type WorldBackupReason = 'manual' | 'version-change' | 'before-restore';
