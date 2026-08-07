import type { GlobalSettings } from '../../shared/ipc-types';
import { DEFAULT_NEWS_FEED_URL, DEFAULT_ANNOUNCEMENT_FEED_URL } from '../../shared/branding';

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
  // Point at White Ravens' published feeds; both are replaceable in Settings,
  // and an empty string means "no feed" rather than "back to the default".
  // Fork these in src/shared/branding.ts, not here.
  newsFeedUrl: DEFAULT_NEWS_FEED_URL,
  announcementFeedUrl: DEFAULT_ANNOUNCEMENT_FEED_URL,
  trustedPublicKeys: [],
  autoRemoveOrphanedMods: false,
  showLiveConsole: false,
  offlineMode: false,
};
