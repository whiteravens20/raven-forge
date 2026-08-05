// Raven Forge Launcher — application-wide constants

export const APP_NAME = 'Raven Forge Launcher';
export const APP_ID = 'com.ravenforge.launcher';
export const APP_VERSION = '0.1.0';

// ── Data directory names ──────────────────────────────────
export const DIR_PROFILES = 'profiles';
export const DIR_LOADERS = 'loaders';
export const DIR_JAVA = 'java';
export const DIR_CACHE = 'cache';
export const DIR_LOGS = 'logs';
export const DIR_BACKGROUNDS = 'backgrounds';

// ── File names ────────────────────────────────────────────
export const FILE_SETTINGS = 'settings.json';
export const FILE_PROFILES = 'profiles.json';
export const FILE_INSTALLED_LOCK = 'installed.lock';

// ── Modrinth API ──────────────────────────────────────────
export const MODRINTH_API_BASE = 'https://api.modrinth.com/v2';
export const MODRINTH_USER_AGENT = `whiteravens20/raven-forge/${APP_VERSION} (https://github.com/whiteravens20/raven-forge)`;

// ── Mod loaders ───────────────────────────────────────────
/**
 * The loaders this launcher can install, and therefore the only ones worth
 * offering as a search filter.
 *
 * Modrinth files Bukkit, Paper, Velocity and the rest of the server platforms
 * under project type `mod` too — correct for Modrinth, useless here: a launcher
 * starts a client, and none of those ever run in one.
 */
export const CLIENT_MOD_LOADERS = ['fabric', 'forge', 'neoforge', 'quilt'] as const;
export type ClientModLoader = (typeof CLIENT_MOD_LOADERS)[number];

export function isClientModLoader(value: string): value is ClientModLoader {
  return (CLIENT_MOD_LOADERS as readonly string[]).includes(value);
}

// ── Minecraft APIs ────────────────────────────────────────
export const MOJANG_VERSION_MANIFEST =
  'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
export const MOJANG_RESOURCES = 'https://resources.download.minecraft.net';
export const MC_SERVICES_API = 'https://api.minecraftservices.com';

// ── Auth endpoints ────────────────────────────────────────
export const MS_AUTH_BASE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
export const XBOX_AUTH_URL = 'https://user.auth.xboxlive.com/user/authenticate';
export const XSTS_AUTH_URL = 'https://xsts.auth.xboxlive.com/xsts/authorize';
export const MC_AUTH_URL = `${MC_SERVICES_API}/authentication/login_with_xbox`;
export const MC_ENTITLEMENTS_URL = `${MC_SERVICES_API}/entitlements/mcstore`;
export const MC_PROFILE_URL = `${MC_SERVICES_API}/minecraft/profile`;

// ── Mod loader APIs ───────────────────────────────────────
export const FABRIC_META_API = 'https://meta.fabricmc.net/v2';
export const QUILT_META_API = 'https://meta.quiltmc.org/v3';
/** Maven roots for the `forge`/`neoforge` artifacts — metadata and installers. */
export const FORGE_MAVEN_ROOT = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
export const NEOFORGE_MAVEN_ROOT = 'https://maven.neoforged.net/releases/net/neoforged/neoforge';
/**
 * NeoForge's Minecraft 1.20.1 line, which predates the rename and still lives
 * under the `forge` artifact with Forge-style `<mc>-<build>` versions. It is the
 * only Minecraft version this artifact ever carried.
 */
export const NEOFORGE_LEGACY_MAVEN_ROOT =
  'https://maven.neoforged.net/releases/net/neoforged/forge';
/** The only place Forge publishes which build is "recommended" rather than merely newest. */
export const FORGE_PROMOTIONS_URL =
  'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';

// ── Adoptium JRE ──────────────────────────────────────────
export const ADOPTIUM_API = 'https://api.adoptium.net/v3';

// ── Java version mapping ──────────────────────────────────
export const JAVA_VERSION_MAP: Record<string, number> = {
  // Versions ≤ 1.16.5 need Java 8
  '1.7': 8,
  '1.8': 8,
  '1.9': 8,
  '1.10': 8,
  '1.11': 8,
  '1.12': 8,
  '1.13': 8,
  '1.14': 8,
  '1.15': 8,
  '1.16': 8,
  // 1.17 – 1.20.4 need Java 17
  '1.17': 17,
  '1.18': 17,
  '1.19': 17,
  '1.20': 17,
  // 1.21+ needs Java 21
  '1.21': 21,
  '1.22': 21,
  '1.23': 21,
};

// ── Download defaults ─────────────────────────────────────
export const DEFAULT_DOWNLOAD_CONCURRENCY = 4;
export const MAX_DOWNLOAD_CONCURRENCY = 8;
export const HASH_VERIFY_RETRIES = 3;

// ── Window defaults ───────────────────────────────────────
export const DEFAULT_WINDOW_WIDTH = 1280;
export const DEFAULT_WINDOW_HEIGHT = 800;
export const MIN_WINDOW_WIDTH = 900;
export const MIN_WINDOW_HEIGHT = 600;

// ── Default RAM ───────────────────────────────────────────
export const DEFAULT_RAM_MB = 4096;
export const MIN_RAM_MB = 512;
export const MAX_RAM_MB = 32768;
