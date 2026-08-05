import type { NewsItem, Announcement } from '../../shared/ipc-types';

/**
 * Mock news data — displayed when newsFeedUrl is not configured.
 *
 * To use real data, set "newsFeedUrl" in Settings (or settings.json) to a URL
 * returning a JSON array of NewsItem objects. See README.md for the schema.
 */
export const MOCK_NEWS: NewsItem[] = [
  {
    id: 'mock-1',
    title: 'Welcome to Raven Forge Launcher!',
    excerpt:
      'Your new Minecraft launcher is ready. Create a server profile, sync mods, and start playing.',
    body: [
      'Everything starts with a profile: a Minecraft version, a mod loader, and how much memory the game gets.',
      '',
      '## Getting started',
      '- Sign in under **Accounts**',
      '- Create a profile under **Profiles**',
      '- Press **Play**',
      '',
      'Java is downloaded for you if the version you picked needs one you do not have.',
    ].join('\n'),
    url: 'https://github.com/whiteravens20/raven-forge',
    imageUrl: undefined,
    publishedAt: '2026-03-17T00:00:00Z',
  },
  {
    id: 'mock-2',
    title: 'Mod Sync: How It Works',
    excerpt:
      'Point your profile to a server manifest URL. The launcher will automatically download, verify, and install the right mods.',
    body: [
      'A manifest is a JSON file listing the mods a server expects, each with a hash.',
      '',
      'The launcher downloads what is missing, checks every file against its hash, and removes mods the manifest has dropped. Anything you installed yourself is left alone.',
      '',
      '## Signed manifests',
      'A manifest can be signed with an Ed25519 key. Add the key under **Settings → Trusted keys** and the launcher will refuse a manifest that was altered on the way to you.',
    ].join('\n'),
    url: 'https://github.com/whiteravens20/raven-forge',
    imageUrl: undefined,
    publishedAt: '2026-03-16T00:00:00Z',
  },
  {
    id: 'mock-3',
    title: 'Modrinth Integration',
    excerpt:
      'Browse and install mods from Modrinth directly inside the launcher. No API key needed.',
    body: [
      'Search mods, shaders and resource packs without leaving the launcher.',
      '',
      'Results are filtered to your profile by default, and every filter is visible so you can widen it. A mod that has no build for your Minecraft version genuinely will not appear — the filter row tells you why.',
      '',
      'CurseForge is available too, but it requires an API key of your own under **Settings**.',
    ].join('\n'),
    url: 'https://modrinth.com',
    imageUrl: undefined,
    publishedAt: '2026-03-15T00:00:00Z',
  },
  {
    id: 'mock-4',
    title: 'Every mod loader, installed for you',
    excerpt:
      'Fabric, Quilt, Forge and NeoForge all install from the profile screen — Forge and NeoForge by running their official installer, because since 1.13 the modded client is patched together on your machine.',
    body: [
      'Pick a loader on the profile screen and the launcher fetches the versions that actually exist for your Minecraft version.',
      '',
      '## Why Forge takes longer',
      'Since Minecraft 1.13 there is no ready-made modded client to download. Forge and NeoForge ship an installer that patches the vanilla jar on your machine, so the launcher runs that installer once per profile and reads the resulting version definition back.',
    ].join('\n'),
    url: 'https://github.com/whiteravens20/raven-forge',
    imageUrl: undefined,
    publishedAt: '2026-03-14T00:00:00Z',
  },
];

/**
 * Mock announcements — displayed when announcementFeedUrl is not configured.
 *
 * To use real data, set "announcementFeedUrl" in Settings (or settings.json) to a URL
 * returning a JSON array of Announcement objects. See README.md for the schema.
 */
export const MOCK_ANNOUNCEMENTS: Announcement[] = [
  {
    id: 'mock-announce-1',
    message:
      'This is a development build of Raven Forge Launcher. Configure your news and announcement feeds in Settings.',
    type: 'info',
    url: undefined,
    dismissible: true,
  },
];
