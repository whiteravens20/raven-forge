// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

// Everything the settings page writes.
// Part of the IPC contract — see `../ipc-types.ts`.

export type ThemeMode = 'dark' | 'oled-black' | 'light';
export type LauncherBehaviorOnLaunch = 'close' | 'minimize' | 'keep-open';

/** UI languages the launcher ships dictionaries for (`src/renderer/i18n/`). */
export type Locale = 'pl' | 'en';

export interface GlobalSettings {
  theme: ThemeMode;
  language: Locale;
  launcherBehaviorOnLaunch: LauncherBehaviorOnLaunch;
  proxyUrl?: string;
  downloadConcurrency: number;
  newsFeedUrl?: string;
  announcementFeedUrl?: string;
  trustedPublicKeys: TrustedKey[];
  showLiveConsole: boolean;
  /** Show the running profile on the player's Discord status. */
  discordRichPresence: boolean;
  /** Never contact auth servers; launch offline. Singleplayer and LAN only. */
  offlineMode: boolean;
  /**
   * Install a Forge/NeoForge loader whose repository publishes no checksum
   * beside the installer jar. Off by default: that jar is executed.
   */
  allowUnverifiedLoaderInstaller: boolean;
}

export interface TrustedKey {
  name: string;
  publicKey: string;
  addedAt: string;
}

/**
 * Where the launcher's data lives.
 *
 * `default` is Electron's own per-user directory; `pointer` is a directory
 * chosen in Settings; `env` is `RAVENFORGE_DATA_DIR`, which outranks both and
 * is deliberately not settable from the UI — a portable install sets it, and a
 * click should not be able to write a path back onto the host machine.
 */
export type DataRootSource = 'default' | 'pointer' | 'env';

export interface DataRootInfo {
  /** Where the data is right now. */
  path: string;
  /** Where it would be with nothing configured: the launcher's home. */
  defaultPath: string;
  source: DataRootSource;
  /** The path has a space in it, which some mods and tools mishandle. */
  hasSpaces: boolean;
  /** The path has a character outside ASCII in it — the same concern. */
  hasNonAscii: boolean;
  /**
   * A configured root that could not be reached — an unplugged drive — with the
   * default standing in. The UI has to say so, or the launcher merely looks
   * empty.
   */
  unavailable?: string;
}

/** What choosing a directory would do, worked out before anything is touched. */
export interface DataRootPlan {
  /**
   * Where the data would end up. Not always the folder that was picked: one
   * that already holds other things gets a folder of the launcher's own inside
   * it, and this names that.
   */
  target: string;
  /**
   * `move` carries the current data across. `adopt` leaves it where it is and
   * uses what the target already holds — which is how you switch back to a root
   * you used before, without copying over the top of it.
   */
  action: 'move' | 'adopt';
  bytesToMove: number;
  /** Free space at the target, when the platform will say. */
  freeBytes?: number;
  /** On the volume the data is on now, so nothing has to be copied. */
  sameVolume: boolean;
  /**
   * The target holds the launcher's file names with no profiles behind them —
   * what an interrupted move leaves, or a launcher that only stood in there —
   * and they would be replaced.
   */
  replacesDebris?: boolean;
  /**
   * The data would be leaving the launcher's home, which stays where it is and
   * keeps the pointer and the embedded browser's files.
   */
  leavesHome?: boolean;
  /** See {@link DataRootInfo.hasSpaces}; about the target. */
  hasSpaces: boolean;
  hasNonAscii: boolean;
  /** Set when the choice cannot be applied; the UI explains it and offers no button. */
  problem?: DataRootProblem;
}

export type DataRootProblem =
  /** Already the current root. */
  | 'same'
  /** Inside the current root, so moving into it would eat itself. */
  | 'nested'
  /** Cannot be written to. */
  | 'notWritable'
  /** Holds other files, and so does the folder the launcher would make in it. */
  | 'notEmpty'
  /** Less free space than the move needs. */
  | 'noSpace'
  /** `RAVENFORGE_DATA_DIR` decides for this install. */
  | 'envLocked'
  /** A game is running out of the directory, or one is being got ready. */
  | 'gameRunning';

/**
 * How a move ended.
 *
 * `leftovers` are originals that were copied across and then could not be
 * removed. The data is safe in the new place either way; these are the old
 * copies, and the person who moved them has to be told where they still are.
 */
export interface DataRootMoveResult {
  target: string;
  leftovers: string[];
}
