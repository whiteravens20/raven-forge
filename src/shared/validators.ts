import { z } from 'zod';

// ── Runtime validators for IPC payloads ───────────────────
// These schemas validate data at IPC boundaries.
// Types are inferred from schemas via z.infer<typeof schema>.

export const trustedKeySchema = z.object({
  name: z.string().min(1),
  publicKey: z.string().min(1),
  addedAt: z.string(),
});

/**
 * Proxy schemes with a working implementation behind them. `socks5h` is
 * accepted as an alias because it is what curl users type; SOCKS here always
 * resolves DNS at the proxy, so the two behave identically.
 */
export const PROXY_SCHEMES = [
  'http:',
  'https:',
  'socks:',
  'socks4:',
  'socks4a:',
  'socks5:',
  'socks5h:',
];

export const globalSettingsSchema = z.object({
  theme: z.enum(['dark', 'oled-black', 'light']),
  // `.catch` rather than `.default`: an unknown language in an existing
  // settings file must not fail the whole parse and reset every other setting.
  language: z.enum(['pl', 'en']).catch('pl'),
  launcherBehaviorOnLaunch: z.enum(['close', 'minimize', 'keep-open']),
  // Validated rather than free text: an unparseable URL used to be accepted and
  // then silently ignored. Every scheme listed here has a dispatcher behind it —
  // http/https through undici's ProxyAgent, socks through a connect hook — so
  // nothing that saves cleanly can fail to take effect.
  proxyUrl: z
    .string()
    .optional()
    .or(z.literal(''))
    .refine(
      (v) => {
        if (!v) return true;
        try {
          return PROXY_SCHEMES.includes(new URL(v).protocol);
        } catch {
          return false;
        }
      },
      { message: 'Proxy must be an http://, https://, socks5:// or socks4:// URL' },
    ),
  downloadConcurrency: z.number().min(1).max(8).default(4),
  customBackgroundsPath: z.string().optional(),
  newsFeedUrl: z.string().url().optional().or(z.literal('')),
  announcementFeedUrl: z.string().url().optional().or(z.literal('')),
  trustedPublicKeys: z.array(trustedKeySchema).default([]),
  autoRemoveOrphanedMods: z.boolean().default(false),
  showLiveConsole: z.boolean().default(false),
  /**
   * Never contact the auth servers; launch every profile with the offline
   * session token. Singleplayer and LAN only — an online-mode server rejects it.
   * A single launch can override this either way.
   */
  offlineMode: z.boolean().default(false),
});

export const profileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  iconPath: z.string().optional(),
  iconUrl: z.string().url().optional(),
  iconPreset: z.string().optional(),
  minecraftVersion: z.string().min(1),
  modLoader: z.enum(['vanilla', 'forge', 'neoforge', 'fabric', 'quilt']),
  modLoaderVersion: z.string().optional(),
  manifestUrl: z.string().url().optional(),
  serverIp: z.string().optional(),
  serverPort: z.number().min(1).max(65535).optional(),
  javaArgs: z.string().optional(),
  allocatedRamMb: z.number().min(512).max(32768),
  customJavaPath: z.string().optional(),
  windowWidth: z.number().optional(),
  windowHeight: z.number().optional(),
  fullscreen: z.boolean().optional(),
  gameDirectory: z.string().optional(),
  preLaunchCommand: z.string().optional(),
  notes: z.string().optional(),
  lastPlayed: z.string().optional(),
  totalPlayTimeMinutes: z.number().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const newsItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  excerpt: z.string(),
  body: z.string().optional(),
  // Optional: the launcher renders `body` itself, so a feed that has no website
  // behind it is a complete feed rather than a broken one.
  url: z.string().url().optional(),
  imageUrl: z.string().url().optional(),
  publishedAt: z.string(),
});

export const announcementSchema = z.object({
  id: z.string(),
  message: z.string(),
  type: z.enum(['info', 'warning', 'urgent']),
  title: z.string().optional(),
  body: z.string().optional(),
  url: z.string().url().optional(),
  dismissible: z.boolean(),
});
