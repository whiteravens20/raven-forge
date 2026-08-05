import type { GlobalSettings } from '../../shared/ipc-types';

/**
 * Default global settings — used on first launch or after settings reset.
 */
export const DEFAULT_SETTINGS: GlobalSettings = {
  theme: 'dark',
  // The UI is written in Polish and English is the translation, so a fresh
  // install starts Polish. See src/renderer/i18n/.
  language: 'pl',
  launcherBehaviorOnLaunch: 'minimize',
  proxyUrl: undefined,
  downloadConcurrency: 4,
  customBackgroundsPath: undefined,
  // When empty/undefined, the launcher uses built-in mock data.
  // Set these to a real URL to pull live news and announcements.
  // See README.md → "Configuration: News Feed, Backgrounds & Announcements"
  newsFeedUrl: undefined,
  announcementFeedUrl: undefined,
  curseforgeApiKey: undefined,
  trustedPublicKeys: [],
  autoRemoveOrphanedMods: false,
  showLiveConsole: false,
  offlineMode: false,
};
