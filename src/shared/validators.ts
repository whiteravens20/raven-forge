import { z } from 'zod';
import { DEFAULT_NEWS_FEED_URL, DEFAULT_ANNOUNCEMENT_FEED_URL } from './branding';
import {
  MAX_GAME_DIMENSION,
  MAX_RAM_MB,
  MIN_GAME_HEIGHT,
  MIN_GAME_WIDTH,
  MIN_RAM_MB,
} from './constants';
import { isSafeFileName } from './manifest-schema';

// ── Runtime validators for IPC payloads ───────────────────
// These schemas validate data at IPC boundaries.
// Types are inferred from schemas via z.infer<typeof schema>.

/**
 * Whether a URL is safe to fetch content the launcher then *acts on* — a
 * manifest whose mods land on the class path, a pack that becomes a profile.
 *
 * HTTPS always; plaintext HTTP only to loopback. A manifest or pack fetched
 * over http can be rewritten in transit — the signature stripped, the mod URLs
 * repointed — by anyone on the path between here and the host, so the plaintext
 * ones are refused before a byte is downloaded. Loopback stays open so a pack
 * author can serve from `http://localhost` while they build one, where there is
 * no wire to tamper with. News and announcement feeds are render-only data and
 * are not held to this.
 */
export function isSecureContentUrl(value: string): boolean {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  if (u.protocol === 'https:') return true;
  if (u.protocol === 'http:') {
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname);
  }
  return false;
}

/** Throwing form of {@link isSecureContentUrl}, for the fetch boundaries. */
export function assertSecureContentUrl(value: string): void {
  if (!isSecureContentUrl(value)) {
    throw new Error(
      'A manifest or pack URL must be https:// (plain http:// is allowed only for localhost). ' +
        'Fetched over http it could be tampered with in transit.',
    );
  }
}

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
  // Defaulted here as well as in DEFAULT_SETTINGS, because that one only covers
  // a first launch: an install predating the feeds has a settings.json with the
  // keys absent, and without a default it would stay newsless forever. An empty
  // string is a stored, deliberate "off" and survives the parse untouched.
  newsFeedUrl: z.string().url().or(z.literal('')).default(DEFAULT_NEWS_FEED_URL),
  announcementFeedUrl: z.string().url().or(z.literal('')).default(DEFAULT_ANNOUNCEMENT_FEED_URL),
  trustedPublicKeys: z.array(trustedKeySchema).default([]),
  autoRemoveOrphanedMods: z.boolean().default(false),
  showLiveConsole: z.boolean().default(false),
  /**
   * Off unless asked for. It publishes what the player is doing to everyone who
   * can see their Discord profile, and it competes with the presence mods —
   * CraftPresence and the like — that already say more than the launcher can,
   * since Discord shows one activity at a time.
   */
  discordRichPresence: z.boolean().default(false),
  /**
   * Never contact the auth servers; launch every profile with the offline
   * session token. Singleplayer and LAN only — an online-mode server rejects it.
   * A single launch can override this either way.
   */
  offlineMode: z.boolean().default(false),
  /**
   * Whether a loader installer with no published checksum may still be run.
   *
   * Off, because the launcher already refuses an unverifiable JRE for exactly
   * this reason and the Forge installer is the same kind of artefact: a jar this
   * process executes. Maven publishes `.sha1`/`.sha256` sidecars beside almost
   * everything, so the case this covers is a genuinely old artefact whose
   * repository never wrote one — rare, real, and the player's call rather than
   * a silent log line.
   */
  allowUnverifiedLoaderInstaller: z.boolean().default(false),
});

export const profileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  iconPath: z.string().optional(),
  iconUrl: z.string().url().optional(),
  iconPreset: z.string().optional(),
  // Not free text: this becomes a directory name under `cache/natives/`, a
  // cache file name and part of the assets path, all before the Mojang lookup
  // that would reject an id nobody publishes. Anything Mojang has ever released
  // passes — including the joke snapshots with spaces in them — while a value
  // that would mean something to a path does not.
  minecraftVersion: z.string().refine(isSafeFileName, {
    message: 'minecraftVersion must be a plain version id',
  }),
  modLoader: z.enum(['vanilla', 'forge', 'neoforge', 'fabric', 'quilt']),
  modLoaderVersion: z.string().optional(),
  manifestUrl: z.string().url().optional(),
  serverIp: z.string().optional(),
  serverPort: z.number().min(1).max(65535).optional(),
  javaArgs: z.string().optional(),
  allocatedRamMb: z.number().min(MIN_RAM_MB).max(MAX_RAM_MB),
  customJavaPath: z.string().optional(),
  /**
   * The game's window. All three degrade to "unset" instead of failing the
   * parse, and that is deliberate: this schema is not only the editor's gate —
   * every play session ends in an `updateProfile` that runs the whole profile
   * through it, so a file hand-edited to a resolution the game cannot make
   * would otherwise become a profile whose play time can never be recorded
   * again. Refusing to start over a window size would be the wrong trade; the
   * editor is where a bad number gets argued with.
   *
   * Width and height are still checked at launch, in `customResolution`, since
   * `profiles.json` is read back without going through this at all.
   */
  windowWidth: z
    .number()
    .int()
    .min(MIN_GAME_WIDTH)
    .max(MAX_GAME_DIMENSION)
    .optional()
    .catch(undefined),
  windowHeight: z
    .number()
    .int()
    .min(MIN_GAME_HEIGHT)
    .max(MAX_GAME_DIMENSION)
    .optional()
    .catch(undefined),
  /** Unset means "whatever the game last did" — see `applyFullscreen`. */
  fullscreen: z.boolean().optional().catch(undefined),
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
