// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

// A profile: what it targets, what it has played, what it owns on disk.
// Part of the IPC contract — see `../ipc-types.ts`.

export type ModLoaderType = 'vanilla' | 'forge' | 'neoforge' | 'fabric' | 'quilt';

/** A mod loader build offered for a given Minecraft version. */
export interface LoaderVersion {
  version: string;
  /** False for a build its loader publishes as a prerelease. */
  stable: boolean;
  /**
   * The one build the loader itself points people at, where it names one —
   * Fabric's current build, Forge's promoted one. Not the same thing as
   * `stable`: every other Fabric build is finished software too.
   */
  recommended?: boolean;
}

export interface Profile {
  id: string;
  name: string;
  /**
   * File name of a user-supplied image, copied into the profile directory —
   * `icon.png`. A name and not a path, so it stays true when the data moves.
   */
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
  /**
   * The game's own language, as a Minecraft locale code (`pl_pl`). Unset leaves
   * the choice to the game, which starts in English and then remembers what the
   * player picked there.
   */
  gameLanguage?: string;
  notes?: string;
  lastPlayed?: string;
  totalPlayTimeMinutes?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileSyncStatus {
  profileId: string;
  pendingUpdates: number;
  status: 'synced' | 'updates-available' | 'error' | 'never-synced';
  errorMessage?: string;
  /**
   * Set for a profile made from a pack file rather than from an address. It
   * follows nothing, so there is never an update to fetch — but the pack it was
   * installed from is kept, and a sync checks the profile against that again:
   * to finish an install that stopped half-way, or to put back what was
   * deleted by hand.
   */
  importedPack?: boolean;
}

/**
 * A profile made for a pack, and whether the pack's files all arrived.
 *
 * Both, because the profile is created before its files are fetched and exists
 * either way. Reporting only the failure left a half-filled profile that no
 * list showed until something else reloaded it, and every "Install again" made
 * another one beside it.
 */
export interface PackInstall {
  profile: Profile;
  /** Why the install stopped short, in the main process's own words. */
  failure?: string;
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
 * Entries of the profile list that are not profiles.
 *
 * A file edited by hand can hold one — a profile with no loader named, say. It
 * is left in the file as it is and out of the list, and the count and the
 * file's path are what the profiles page has to say so with.
 */
export interface UnreadableProfileEntries {
  count: number;
  file: string;
}

/**
 * A profile made from an exported profile file.
 *
 * `dropped` names the fields the file carried that an import never honours —
 * a Java path, JVM arguments, a pack address — so the person importing is told
 * what did not come across instead of finding out at the first launch.
 */
export interface ProfileImport {
  profile: Profile;
  dropped: string[];
}

/**
 * What exporting a profile as a `.mrpack` produced.
 *
 * The counts are the point: a pack is references, not jars, so the difference
 * between `files` and `bundled` is the difference between a 20 KB file anyone
 * can install and a 300 MB one carrying somebody's hand-built mods. Reporting
 * both is what lets the player see which they got, and why.
 */
/** What the player chose to put in an exported pack beyond its mods. */
export interface MrpackExportOptions {
  /**
   * The game's settings and each mod's configuration: `options.txt` and the
   * `config` folder. They are what makes a pack play the way its author set it
   * up, and they are also the author's own — so it is asked.
   */
  settings?: boolean;
}

export interface MrpackExport {
  path: string;
  /** Entries the recipient downloads from Modrinth. */
  files: number;
  /** Files carried inside the archive because Modrinth does not host them. */
  bundled: number;
  bundledBytes: number;
  /** Files of the author's own settings carried along: `options.txt` and the `config` folder. */
  settingsFiles: number;
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
