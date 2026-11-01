// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import type { GlobalSettings } from '../../shared/ipc-types';
import { DEFAULT_NEWS_FEED_URL, DEFAULT_ANNOUNCEMENT_FEED_URL } from '../../shared/branding';

/**
 * Default global settings — used on first launch or after settings reset.
 */
export const DEFAULT_SETTINGS: GlobalSettings = {
  theme: 'dark',
  // A first start has `freshSettings` put the system's language here.
  language: 'en',
  launcherBehaviorOnLaunch: 'minimize',
  proxyUrl: undefined,
  downloadConcurrency: 4,
  // Point at White Ravens' published feeds; both are replaceable in Settings,
  // and an empty string means "no feed" rather than "back to the default".
  // Fork these in src/shared/branding.ts, not here.
  newsFeedUrl: DEFAULT_NEWS_FEED_URL,
  announcementFeedUrl: DEFAULT_ANNOUNCEMENT_FEED_URL,
  trustedPublicKeys: [],
  showLiveConsole: false,
  discordRichPresence: false,
  offlineMode: false,
  allowUnverifiedLoaderInstaller: false,
};
