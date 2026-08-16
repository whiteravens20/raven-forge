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
