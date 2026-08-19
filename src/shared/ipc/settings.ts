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
  autoRemoveOrphanedMods: boolean;
  showLiveConsole: boolean;
  /** Show the running profile on the player's Discord status. */
  discordRichPresence: boolean;
  /** Never contact auth servers; launch offline. Singleplayer and LAN only. */
  offlineMode: boolean;
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
  /** Where it would be with nothing configured. */
  defaultPath: string;
  source: DataRootSource;
  /**
   * A configured root that could not be reached — an unplugged drive — with the
   * default standing in. The UI has to say so, or the launcher merely looks
   * empty.
   */
  unavailable?: string;
}

/** What choosing a directory would do, worked out before anything is touched. */
export interface DataRootPlan {
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
  /** Less free space than the move needs. */
  | 'noSpace'
  /** `RAVENFORGE_DATA_DIR` decides for this install. */
  | 'envLocked'
  /** A game is running out of the directory. */
  | 'gameRunning';
