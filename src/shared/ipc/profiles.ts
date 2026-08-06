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
 * One pack in the White Ravens catalogue, as the picker needs it.
 *
 * `manifestUrl` is the whole point — a profile created from this follows that
 * URL and keeps updating, rather than being a snapshot. Entries without one are
 * dropped before they reach here.
 */
