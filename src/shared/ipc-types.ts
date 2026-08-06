// ============================================================================
// Raven Forge Launcher — IPC Channel Type Definitions
// All communication between main ↔ renderer goes through these typed channels.
// Renderer invokes via: window.ravenforge.<domain>.<method>(args)
// Main handles via: ipcMain.handle(channel, handler)
// Main pushes via: webContents.send(channel, payload)
// ============================================================================

// ---------------------------------------------------------------------------
// Shared / Utility Types
// ---------------------------------------------------------------------------

export interface IpcResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  /**
   * A stable machine-readable tag for failures the UI must react to rather than
   * merely display. Matching on `error` text would break the moment anyone
   * rewords it, and it is translated.
   */
  code?: IpcErrorCode;
}

/**
 * `AUTH_UNREACHABLE` — Microsoft's or Mojang's auth endpoints could not be
 * reached, as opposed to rejecting us. The distinction matters: unreachable is
 * recoverable by launching offline, rejected is not.
 */
export type IpcErrorCode = 'AUTH_UNREACHABLE';

export interface ProgressEvent {
  /** Unique ID for the operation (e.g. profile ID or download batch ID) */
  operationId: string;
  /** 0.0 – 1.0 */
  progress: number;
  /** Human-readable status message */
  message: string;
  /** Current file being processed (if applicable) */
  currentFile?: string;
  /** Bytes downloaded so far */
  bytesDownloaded?: number;
  /** Total bytes expected */
  bytesTotal?: number;
  /** Files completed / total */
  filesCompleted?: number;
  filesTotal?: number;
}

// ---------------------------------------------------------------------------
// Auth Types
// ---------------------------------------------------------------------------

export interface MinecraftAccount {
  id: string;
  uuid: string;
  username: string;
  type: 'microsoft' | 'offline';
  skinUrl?: string;
  /** ISO 8601 timestamp of last successful auth */
  lastAuthenticated?: string;
}

export interface AuthState {
  accounts: MinecraftAccount[];
  activeAccountId: string | null;
  isAuthenticating: boolean;
  /**
   * The OS keychain was unusable, so credentials are in a 0600 file instead.
   * Shown on the Accounts page — it is a real reduction in protection and the
   * person it applies to is the one entitled to know about it.
   */
  credentialsInPlaintext?: boolean;
  /** Where that file is, so the warning can name it. */
  credentialsFile?: string;
}

// ---------------------------------------------------------------------------
// Profile Types
// ---------------------------------------------------------------------------

export type ModLoaderType = 'vanilla' | 'forge' | 'neoforge' | 'fabric' | 'quilt';

/** A mod loader build offered for a given Minecraft version. */
export interface LoaderVersion {
  version: string;
  stable: boolean;
}

export interface Profile {
  id: string;
  name: string;
  /** Absolute path to a user-supplied image, copied into the profile directory. */
  iconPath?: string;
  iconUrl?: string;
  /** Id of one of the launcher's built-in avatars, e.g. `raven`. */
  iconPreset?: string;
  minecraftVersion: string;
  modLoader: ModLoaderType;
  modLoaderVersion?: string;
  manifestUrl?: string;
  serverIp?: string;
  serverPort?: number;
  javaArgs?: string;
  allocatedRamMb: number;
  customJavaPath?: string;
  windowWidth?: number;
  windowHeight?: number;
  fullscreen?: boolean;
  gameDirectory?: string;
  preLaunchCommand?: string;
  notes?: string;
  lastPlayed?: string;
  totalPlayTimeMinutes?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileSyncStatus {
  profileId: string;
  lastSyncedAt?: string;
  manifestEtag?: string;
  pendingUpdates: number;
  status: 'synced' | 'updates-available' | 'error' | 'never-synced';
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Mod Types
// ---------------------------------------------------------------------------

export type ModSource = 'modrinth' | 'url' | 'local';
export type ModSide = 'client' | 'server' | 'both';

export interface InstalledMod {
  id: string;
  name: string;
  version: string;
  source: ModSource;
  fileName: string;
  sha256?: string;
  required: boolean;
  side: ModSide;
  enabled: boolean;
  /** true = from server manifest, false = user-installed */
  fromManifest: boolean;
}

export interface ModSearchResult {
  id: string;
  slug: string;
  name: string;
  description: string;
  author: string;
  iconUrl?: string;
  downloads: number;
  versions: string[];
  categories: string[];
}

/** What Modrinth calls a project type. Shaders and resource packs are not mods. */
export type ContentProjectType = 'mod' | 'shader' | 'resourcepack';

/**
 * Search facets for one project type. `groups` mirrors Modrinth's own headers —
 * `resolutions` / `features` / `categories` for resource packs, and
 * `features` / `categories` / `performance impact` for shaders — because those
 * are separate questions and a single flat list cannot express a combination.
 */
export interface FacetGroups {
  loaders: string[];
  groups: Array<{ header: string; names: string[] }>;
  /**
   * Minecraft releases as Modrinth spells them, newest first. Taken from
   * Modrinth rather than Mojang: these are the exact strings the `versions:`
   * facet matches, so the dropdown cannot offer a version that finds nothing.
   */
  gameVersions: string[];
}

/** One shader loader on offer, already confirmed to have a build for the profile. */
export interface ShaderLoaderOption {
  /** Modrinth project id. */
  id: string;
  name: string;
  /** Newest build for this profile's Minecraft version and mod loader. */
  version: string;
  /** What comes with it — Iris needs Sodium, Oculus needs Embeddium. */
  dependencies: string[];
  /** Preselected in the picker. */
  recommended: boolean;
}

/**
 * Whether the profile can load a shader pack, and what it could be offered.
 *
 * A shader pack with no loader behind it is a zip in a folder nothing reads, so
 * this is asked *before* nagging: the install looks identical either way.
 */
export type ShaderLoaderState =
  | { status: 'already-installed'; name: string }
  | { status: 'choose'; options: ShaderLoaderOption[] }
  /** Candidates exist but none publishes anything for this Minecraft version. */
  | { status: 'no-build'; mcVersion: string; modLoader: ModLoaderType }
  /** A vanilla profile cannot run shaders at all — they need a mod. */
  | { status: 'unsupported'; modLoader: ModLoaderType };

export type ShaderLoaderResult =
  | { status: 'installed'; name: string; dependencies: string[] }
  | { status: 'no-build'; mcVersion: string; modLoader: ModLoaderType }
  | { status: 'failed'; error: string };

/**
 * What a profile owns on disk, so deleting it can say what that costs.
 *
 * Counted from the directories, so hand-added files are included. `worlds` is
 * the number that matters — mods and packs download again, saves do not.
 */
export interface ProfileFileSummary {
  mods: number;
  shaders: number;
  resourcePacks: number;
  worlds: number;
  bytes: number;
  /** Where the files are, so keeping them is an offer with an address. */
  path: string;
}

/**
 * A profile's files, still on disk, with no profile pointing at them.
 *
 * Produced by "delete, keep files". Profile directories are keyed by id, so a
 * later profile of the same name never collides with these — it gets its own id
 * and its own empty directory. Which is exactly why they need listing: nothing
 * else would ever lead back to them.
 */
export interface OrphanedProfile {
  profile: Profile;
  files: ProfileFileSummary;
}

/**
 * One pack in the White Ravens catalogue, as the picker needs it.
 *
 * `manifestUrl` is the whole point — a profile created from this follows that
 * URL and keeps updating, rather than being a snapshot. Entries without one are
 * dropped before they reach here.
 */
export interface CataloguePack {
  slug: string;
  name: string;
  version: string;
  summary: string;
  minecraftVersion: string;
  modLoader: string;
  recommendedRamMb?: number;
  serverIp?: string;
  modCount: number;
  totalDownloadBytes: number;
  manifestUrl: string;
}

// ---------------------------------------------------------------------------
// Compatibility
// ---------------------------------------------------------------------------

/**
 * One reason a download would not fit the profile it is aimed at.
 *
 * None of these block an install on their own. Modrinth's metadata is a
 * publisher's claim, not a fact — plenty of mods run on a Minecraft version they
 * never got round to listing — so the launcher's job is to say what it knows and
 * let the player decide. The one genuine dead end is `no-build`, where there is
 * no file to install at all.
 */
export type CompatibilityIssue =
  /** Builds exist for this Minecraft version, but not for the profile's loader. */
  | { kind: 'wrong-loader'; supported: string[] }
  /** Builds exist for the profile's loader, but not for its Minecraft version. */
  | { kind: 'wrong-version'; supported: string[] }
  /** The project publishes nothing this profile could use, on any pairing. */
  | { kind: 'no-build' }
  /** A vanilla profile has no loader, so a mod would never be read. */
  | { kind: 'needs-loader' }
  /** The build declares itself incompatible with something already installed. */
  | { kind: 'conflicts-with'; names: string[] }
  /** A required dependency exists but publishes nothing for this profile. */
  | { kind: 'dependency-no-build'; names: string[] };

/** A required dependency that is missing and would be installed alongside. */
export interface PlannedDependency {
  id: string;
  name: string;
  version: string;
}

/**
 * What installing something into a profile would actually do, worked out before
 * anything is downloaded.
 *
 * `versionId` is the build the check settled on, and installing quotes it back
 * so the player gets the file the warning was about rather than whatever is
 * newest by the time they click through. Its absence means nothing is
 * installable.
 */
export interface InstallPlan {
  name: string;
  versionId?: string;
  versionName?: string;
  dependencies: PlannedDependency[];
  issues: CompatibilityIssue[];
}

/**
 * The outcome of installing a mod: the mod, plus whatever had to come with it.
 *
 * `dependencies` is not decoration. Required dependencies are installed without
 * being asked for, and a launcher that silently adds files to a profile is a
 * launcher nobody can debug — so the names come back to be shown.
 */
export interface ModInstallResult {
  mod: InstalledMod;
  dependencies: string[];
}

export interface ModSearchFilters {
  query: string;
  /** Defaults to `mod`. Shaders and resource packs live in the same search index. */
  projectType?: ContentProjectType;
  loader?: ModLoaderType;
  gameVersion?: string;
  /**
   * Modrinth `categories` facets, ANDed together. This one field carries both
   * genuine categories (`realistic`, `32x`) and loaders (`iris`, `optifine`,
   * `canvas`) because Modrinth files loaders under the same facet key.
   */
  categories?: string[];
  offset?: number;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Java Types
// ---------------------------------------------------------------------------

export interface JavaInstallation {
  version: number;
  path: string;
  vendor: string;
  managed: boolean;
}

// ---------------------------------------------------------------------------
// Settings Types
// ---------------------------------------------------------------------------

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
  customBackgroundsPath?: string;
  newsFeedUrl?: string;
  announcementFeedUrl?: string;
  trustedPublicKeys: TrustedKey[];
  autoRemoveOrphanedMods: boolean;
  showLiveConsole: boolean;
  /** Never contact auth servers; launch offline. Singleplayer and LAN only. */
  offlineMode: boolean;
}

export interface TrustedKey {
  name: string;
  publicKey: string;
  addedAt: string;
}

// ---------------------------------------------------------------------------
// News & Announcements Types
// ---------------------------------------------------------------------------

export interface NewsItem {
  id: string;
  title: string;
  excerpt: string;
  /**
   * Full text, in the small Markdown subset `parseArticle` understands.
   * The launcher reads this itself; `url` is only ever an extra way out.
   */
  body?: string;
  /** Optional — a feed with no website behind it is a supported feed. */
  url?: string;
  imageUrl?: string;
  publishedAt: string;
}

export interface Announcement {
  id: string;
  message: string;
  type: 'info' | 'warning' | 'urgent';
  /** Heading for the reader; the banner still shows `message`. */
  title?: string;
  /** Full text, same subset as {@link NewsItem.body}. */
  body?: string;
  url?: string;
  dismissible: boolean;
}

// ---------------------------------------------------------------------------
// Game Launch Types
// ---------------------------------------------------------------------------

export interface LaunchOptions {
  profileId: string;
  /** Override: connect to server on launch */
  quickConnect?: boolean;
  /**
   * Per-launch override of the global offline setting. Undefined means "use the
   * global setting"; `false` is a deliberate "go online this once" and is not
   * the same thing.
   */
  offlineMode?: boolean;
}

export interface GameLogLine {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface GameExitInfo {
  profileId: string;
  exitCode: number;
  crashed: boolean;
  /** Last N lines of game log if crashed */
  logTail?: string[];
  playTimeMinutes: number;
}

// ---------------------------------------------------------------------------
// Manifest Verification Types
// ---------------------------------------------------------------------------

/**
 * The outcome of checking a manifest's signature — always about the manifest a
 * profile last *installed*, never about one fetched to answer the question.
 */
export interface ManifestVerification {
  signed: boolean;
  valid: boolean;
  signerName?: string;
  error?: string;
  /**
   * No sync has run, so there is nothing to report on yet. Distinct from
   * `signed: false`, which is a finding about a manifest that was installed.
   */
  neverSynced?: boolean;
}

// ---------------------------------------------------------------------------
// Updater Types
// ---------------------------------------------------------------------------

export interface UpdateInfo {
  version: string;
  releaseNotes?: string;
  releaseDate: string;
  downloadSize?: number;
}

/**
 * The outcome of an update check, as four distinct things rather than one
 * nullable one.
 *
 * `checkForUpdates` used to return `null` for "up to date", "this is a dev
 * build" and "the check failed" alike, which is why nothing could be built on
 * top of it: a UI cannot report what it cannot distinguish, and silently
 * showing "you are up to date" after a failed check is a lie with consequences.
 */
export type UpdateCheck =
  | { status: 'up-to-date'; currentVersion: string }
  | { status: 'available'; currentVersion: string; update: UpdateInfo }
  /** Self-update is not possible for this build — `reason` says why. */
  | { status: 'unsupported'; currentVersion: string; reason: UpdateUnsupportedReason }
  | { status: 'failed'; currentVersion: string; error: string };

export type UpdateUnsupportedReason =
  /** Running from source; there is no installed artifact to replace. */
  | 'development'
  /** Installed from a .deb/.rpm — the package manager owns the files, not us. */
  | 'system-package'
  /** macOS needs a signed, notarised bundle, and nothing here builds one yet. */
  | 'unsigned-platform';

// ---------------------------------------------------------------------------
// System Info Types
// ---------------------------------------------------------------------------

export interface SystemInfo {
  /**
   * `app.getVersion()` — the version of the build that is actually running.
   * Not the `APP_VERSION` constant, which is a second copy of the same number
   * and drifts from package.json the first time someone bumps only one.
   */
  launcherVersion: string;
  platform: 'win32' | 'linux' | 'darwin';
  arch: string;
  totalMemoryMb: number;
  freeMemoryMb: number;
  dataDirectory: string;
}

// ============================================================================
// IPC CHANNEL DEFINITIONS
// ============================================================================
// Naming convention: "domain:action"
// Invoke channels: renderer calls, main responds (ipcMain.handle)
// Event channels: main pushes to renderer (webContents.send)
// ============================================================================

/**
 * Invoke Channels — renderer → main (request/response)
 * Usage: ipcRenderer.invoke(channel, ...args) → Promise<result>
 */
export interface InvokeChannels {
  // -- Auth --
  'auth:login-microsoft': () => Promise<IpcResult<MinecraftAccount>>;
  'auth:login-offline': (username: string) => Promise<IpcResult<MinecraftAccount>>;
  'auth:logout': (accountId: string) => Promise<IpcResult<void>>;
  'auth:get-state': () => Promise<IpcResult<AuthState>>;
  'auth:set-active': (accountId: string) => Promise<IpcResult<void>>;
  'auth:refresh': (accountId: string) => Promise<IpcResult<MinecraftAccount>>;

  // -- Profiles --
  'profiles:get-all': () => Promise<IpcResult<Profile[]>>;
  'profiles:get': (profileId: string) => Promise<IpcResult<Profile>>;
  'profiles:create': (
    profile: Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>,
  ) => Promise<IpcResult<Profile>>;
  'profiles:update': (profileId: string, updates: Partial<Profile>) => Promise<IpcResult<Profile>>;
  /** `deleteFiles: false` unlists the profile but leaves its directory, worlds and all. */
  'profiles:delete': (profileId: string, deleteFiles: boolean) => Promise<IpcResult<void>>;
  /** What the profile has on disk, for the delete confirmation to quote. */
  'profiles:get-file-summary': (profileId: string) => Promise<IpcResult<ProfileFileSummary>>;
  /** Profile data kept on disk that nothing on the list points at. */
  'profiles:list-orphaned': () => Promise<IpcResult<OrphanedProfile[]>>;
  /** Put kept files back on the list, under their original id. */
  'profiles:adopt-orphaned': (profileId: string) => Promise<IpcResult<Profile>>;
  /** Delete kept files for good. */
  'profiles:discard-orphaned': (profileId: string) => Promise<IpcResult<void>>;
  'profiles:duplicate': (profileId: string) => Promise<IpcResult<Profile>>;
  'profiles:export': (profileId: string) => Promise<IpcResult<string>>; // returns JSON string
  'profiles:import': (json: string) => Promise<IpcResult<Profile>>;
  'profiles:get-sync-status': (profileId: string) => Promise<IpcResult<ProfileSyncStatus>>;
  /** Copy an image in as the profile's icon; `null` source clears it. */
  'profiles:set-icon': (
    profileId: string,
    sourcePath: string | null,
  ) => Promise<IpcResult<Profile>>;
  /** The profile's icon as a `data:` URL, or `null` if it has none. */
  'profiles:get-icon': (profileId: string) => Promise<IpcResult<string | null>>;

  // -- Packs --
  /** The White Ravens catalogue, from the address compiled into the launcher. */
  'packs:list-catalogue': () => Promise<IpcResult<CataloguePack[]>>;
  /** Create a profile that follows a manifest URL and keeps updating from it. */
  'packs:create-from-manifest': (url: string) => Promise<IpcResult<Profile>>;
  /** Create a profile from a link to either a `.mrpack` or a manifest, sniffed apart. */
  'packs:create-from-url': (url: string) => Promise<IpcResult<Profile>>;
  /** Import a Modrinth `.mrpack` as a new profile — a snapshot, not a subscription. */
  'packs:import-mrpack': (filePath: string) => Promise<IpcResult<Profile>>;

  // -- Mods --
  'mods:get-installed': (profileId: string) => Promise<IpcResult<InstalledMod[]>>;
  'mods:sync-manifest': (profileId: string) => Promise<IpcResult<void>>;
  /** `version` pins a build; omitted, the newest one matching the profile wins. */
  'mods:install-from-search': (
    profileId: string,
    mod: ModSearchResult,
    version?: string,
  ) => Promise<IpcResult<ModInstallResult>>;
  /** What installing this mod would do to the profile, before anything is downloaded. */
  'mods:check-install': (
    profileId: string,
    mod: ModSearchResult,
  ) => Promise<IpcResult<InstallPlan>>;
  'mods:install-from-file': (
    profileId: string,
    filePath: string,
  ) => Promise<IpcResult<InstalledMod>>;
  'mods:uninstall': (profileId: string, modId: string) => Promise<IpcResult<void>>;
  'mods:toggle-enabled': (
    profileId: string,
    modId: string,
    enabled: boolean,
  ) => Promise<IpcResult<void>>;
  'mods:search': (filters: ModSearchFilters) => Promise<IpcResult<ModSearchResult[]>>;
  /** Modrinth's live facet list for a project type, grouped as Modrinth groups it. */
  'mods:get-facets': (projectType: ContentProjectType) => Promise<IpcResult<FacetGroups>>;

  // -- Shaders & Resource Packs --
  'content:get-shaders': (profileId: string) => Promise<IpcResult<InstalledMod[]>>;
  'content:get-resourcepacks': (profileId: string) => Promise<IpcResult<InstalledMod[]>>;
  /** `version` pins a build; omitted, the newest one for the profile's MC version wins. */
  'content:install-shader': (
    profileId: string,
    source: string,
    version?: string,
  ) => Promise<IpcResult<void>>;
  'content:get-shader-loader-state': (profileId: string) => Promise<IpcResult<ShaderLoaderState>>;
  'content:install-shader-loader': (
    profileId: string,
    projectId: string,
  ) => Promise<IpcResult<ShaderLoaderResult>>;
  'content:install-resourcepack': (
    profileId: string,
    source: string,
    version?: string,
  ) => Promise<IpcResult<void>>;
  /**
   * Whether a pack has a build for this profile's Minecraft version.
   *
   * Shaders and resource packs are not distinguished: neither has a mod loader
   * or dependencies, so the Minecraft version is the whole question for both.
   */
  'content:check-install': (
    profileId: string,
    item: ModSearchResult,
  ) => Promise<IpcResult<InstallPlan>>;
  'content:remove-shader': (profileId: string, id: string) => Promise<IpcResult<void>>;
  'content:remove-resourcepack': (profileId: string, id: string) => Promise<IpcResult<void>>;
  'content:reorder-resourcepacks': (
    profileId: string,
    orderedIds: string[],
  ) => Promise<IpcResult<void>>;

  // -- Java --
  'java:get-installations': () => Promise<IpcResult<JavaInstallation[]>>;
  'java:ensure-version': (majorVersion: number) => Promise<IpcResult<JavaInstallation>>;
  'java:detect-system': () => Promise<IpcResult<JavaInstallation[]>>;

  // -- Mod Loaders --
  'loaders:install': (
    loader: ModLoaderType,
    loaderVersion: string,
    mcVersion: string,
  ) => Promise<IpcResult<void>>;
  'loaders:get-versions': (
    loader: ModLoaderType,
    mcVersion: string,
  ) => Promise<IpcResult<LoaderVersion[]>>;
  'loaders:is-installed': (
    loader: ModLoaderType,
    loaderVersion: string,
    mcVersion: string,
  ) => Promise<IpcResult<boolean>>;

  // -- Game Launch --
  'game:launch': (options: LaunchOptions) => Promise<IpcResult<void>>;
  'game:kill': (profileId: string) => Promise<IpcResult<void>>;
  'game:is-running': (profileId: string) => Promise<IpcResult<boolean>>;
  /** Recent stdout already buffered in main, so a console opened mid-game is not blank. */
  'game:get-log-tail': (profileId: string, lines?: number) => Promise<IpcResult<string[]>>;
  /** Minecraft version ids from Mojang, newest first. Releases only unless asked. */
  'game:get-versions': (includeSnapshots?: boolean) => Promise<IpcResult<string[]>>;
  /**
   * Abort whatever long download is running for this profile — the launch
   * prepare phase or a manifest sync. `false` means there was nothing to stop.
   */
  'game:cancel': (profileId: string) => Promise<IpcResult<boolean>>;

  // -- Settings --
  'settings:get': () => Promise<IpcResult<GlobalSettings>>;
  'settings:update': (updates: Partial<GlobalSettings>) => Promise<IpcResult<GlobalSettings>>;
  'settings:reset': () => Promise<IpcResult<GlobalSettings>>;
  'settings:add-trusted-key': (key: TrustedKey) => Promise<IpcResult<void>>;
  'settings:remove-trusted-key': (publicKey: string) => Promise<IpcResult<void>>;

  // -- News & Announcements --
  'news:get': () => Promise<IpcResult<NewsItem[]>>;
  'news:refresh': () => Promise<IpcResult<NewsItem[]>>;
  'announcements:get': () => Promise<IpcResult<Announcement[]>>;
  'announcements:refresh': () => Promise<IpcResult<Announcement[]>>;
  'announcements:dismiss': (id: string) => Promise<IpcResult<void>>;

  // -- Manifest Verification --
  'manifest:verify': (profileId: string) => Promise<IpcResult<ManifestVerification>>;

  // -- Updater --
  'updater:check': () => Promise<IpcResult<UpdateCheck>>;
  'updater:download': () => Promise<IpcResult<void>>;
  'updater:install': () => Promise<IpcResult<void>>; // quits and installs

  // -- System --
  'system:get-info': () => Promise<IpcResult<SystemInfo>>;
  'system:open-path': (path: string) => Promise<IpcResult<void>>;
  'system:open-url': (url: string) => Promise<IpcResult<void>>;
  'system:select-directory': () => Promise<IpcResult<string | null>>;
  'system:select-file': (
    filters?: { name: string; extensions: string[] }[],
  ) => Promise<IpcResult<string | null>>;
  'system:get-logs-path': () => Promise<IpcResult<string>>;
  /** Tail the launcher's own log. Returns oldest-first lines, newest last. */
  'system:read-log': (lines?: number) => Promise<IpcResult<string[]>>;

  // -- Window Controls --
  'window:minimize': () => Promise<void>;
  'window:maximize': () => Promise<void>;
  'window:close': () => Promise<void>;
  'window:is-maximized': () => Promise<boolean>;
}

/**
 * Event Channels — main → renderer (push notifications)
 * Usage: webContents.send(channel, payload)
 * Renderer listens via: window.ravenforge.on(channel, callback)
 */
export interface EventChannels {
  // -- Progress Events --
  'progress:mod-sync': (event: ProgressEvent) => void;
  'progress:mod-download': (event: ProgressEvent) => void;
  'progress:loader-install': (event: ProgressEvent) => void;
  'progress:java-download': (event: ProgressEvent) => void;
  'progress:game-assets': (event: ProgressEvent) => void;
  'progress:launcher-update': (event: ProgressEvent) => void;

  // -- Game Events --
  'game:log': (profileId: string, line: GameLogLine) => void;
  'game:started': (profileId: string) => void;
  'game:exited': (info: GameExitInfo) => void;

  // -- Auth Events --
  'auth:state-changed': (state: AuthState) => void;
  'auth:token-expired': (accountId: string) => void;

  // -- Profile Events --
  'profiles:sync-status-changed': (status: ProfileSyncStatus) => void;
  'profiles:updated': (profile: Profile) => void;

  // -- Updater Events --
  'updater:update-available': (info: UpdateInfo) => void;
  'updater:update-downloaded': (info: UpdateInfo) => void;
  // -- Announcement Events --
  'announcements:new': (announcement: Announcement) => void;

  // -- Window Events --
  'window:maximized-changed': (isMaximized: boolean) => void;
}

// ============================================================================
// Preload API Shape — exposed via contextBridge as window.ravenforge
// ============================================================================

/**
 * The typed API object exposed on `window.ravenforge` via contextBridge.
 * Groups invoke channels by domain for cleaner renderer code.
 *
 * Example usage in React:
 *   const profiles = await window.ravenforge.profiles.getAll();
 *   window.ravenforge.on('game:log', (profileId, line) => { ... });
 */
export interface RavenForgeAPI {
  auth: {
    loginMicrosoft: InvokeChannels['auth:login-microsoft'];
    loginOffline: InvokeChannels['auth:login-offline'];
    logout: InvokeChannels['auth:logout'];
    getState: InvokeChannels['auth:get-state'];
    setActive: InvokeChannels['auth:set-active'];
    refresh: InvokeChannels['auth:refresh'];
  };
  profiles: {
    getAll: InvokeChannels['profiles:get-all'];
    get: InvokeChannels['profiles:get'];
    create: InvokeChannels['profiles:create'];
    update: InvokeChannels['profiles:update'];
    delete: InvokeChannels['profiles:delete'];
    getFileSummary: InvokeChannels['profiles:get-file-summary'];
    listOrphaned: InvokeChannels['profiles:list-orphaned'];
    adoptOrphaned: InvokeChannels['profiles:adopt-orphaned'];
    discardOrphaned: InvokeChannels['profiles:discard-orphaned'];
    duplicate: InvokeChannels['profiles:duplicate'];
    export: InvokeChannels['profiles:export'];
    import: InvokeChannels['profiles:import'];
    getSyncStatus: InvokeChannels['profiles:get-sync-status'];
    setIcon: InvokeChannels['profiles:set-icon'];
    getIcon: InvokeChannels['profiles:get-icon'];
  };
  packs: {
    listCatalogue: InvokeChannels['packs:list-catalogue'];
    createFromManifest: InvokeChannels['packs:create-from-manifest'];
    createFromUrl: InvokeChannels['packs:create-from-url'];
    importMrpack: InvokeChannels['packs:import-mrpack'];
  };
  mods: {
    getInstalled: InvokeChannels['mods:get-installed'];
    syncManifest: InvokeChannels['mods:sync-manifest'];
    installFromSearch: InvokeChannels['mods:install-from-search'];
    checkInstall: InvokeChannels['mods:check-install'];
    installFromFile: InvokeChannels['mods:install-from-file'];
    uninstall: InvokeChannels['mods:uninstall'];
    toggleEnabled: InvokeChannels['mods:toggle-enabled'];
    search: InvokeChannels['mods:search'];
    getFacets: InvokeChannels['mods:get-facets'];
  };
  content: {
    getShaders: InvokeChannels['content:get-shaders'];
    getResourcePacks: InvokeChannels['content:get-resourcepacks'];
    installShader: InvokeChannels['content:install-shader'];
    getShaderLoaderState: InvokeChannels['content:get-shader-loader-state'];
    installShaderLoader: InvokeChannels['content:install-shader-loader'];
    installResourcePack: InvokeChannels['content:install-resourcepack'];
    checkInstall: InvokeChannels['content:check-install'];
    removeShader: InvokeChannels['content:remove-shader'];
    removeResourcePack: InvokeChannels['content:remove-resourcepack'];
    reorderResourcePacks: InvokeChannels['content:reorder-resourcepacks'];
  };
  java: {
    getInstallations: InvokeChannels['java:get-installations'];
    ensureVersion: InvokeChannels['java:ensure-version'];
    detectSystem: InvokeChannels['java:detect-system'];
  };
  loaders: {
    install: InvokeChannels['loaders:install'];
    getVersions: InvokeChannels['loaders:get-versions'];
    isInstalled: InvokeChannels['loaders:is-installed'];
  };
  game: {
    launch: InvokeChannels['game:launch'];
    kill: InvokeChannels['game:kill'];
    isRunning: InvokeChannels['game:is-running'];
    getLogTail: InvokeChannels['game:get-log-tail'];
    getVersions: InvokeChannels['game:get-versions'];
    cancel: InvokeChannels['game:cancel'];
  };
  settings: {
    get: InvokeChannels['settings:get'];
    update: InvokeChannels['settings:update'];
    reset: InvokeChannels['settings:reset'];
    addTrustedKey: InvokeChannels['settings:add-trusted-key'];
    removeTrustedKey: InvokeChannels['settings:remove-trusted-key'];
  };
  news: {
    get: InvokeChannels['news:get'];
    refresh: InvokeChannels['news:refresh'];
  };
  announcements: {
    get: InvokeChannels['announcements:get'];
    refresh: InvokeChannels['announcements:refresh'];
    dismiss: InvokeChannels['announcements:dismiss'];
  };
  manifest: {
    verify: InvokeChannels['manifest:verify'];
  };
  updater: {
    check: InvokeChannels['updater:check'];
    download: InvokeChannels['updater:download'];
    install: InvokeChannels['updater:install'];
  };
  system: {
    getInfo: InvokeChannels['system:get-info'];
    openPath: InvokeChannels['system:open-path'];
    openUrl: InvokeChannels['system:open-url'];
    selectDirectory: InvokeChannels['system:select-directory'];
    selectFile: InvokeChannels['system:select-file'];
    getLogsPath: InvokeChannels['system:get-logs-path'];
    readLog: InvokeChannels['system:read-log'];
  };
  window: {
    minimize: InvokeChannels['window:minimize'];
    maximize: InvokeChannels['window:maximize'];
    close: InvokeChannels['window:close'];
    isMaximized: InvokeChannels['window:is-maximized'];
  };

  // -- Event Listener Registration --
  on: <K extends keyof EventChannels>(channel: K, callback: EventChannels[K]) => void;
  off: <K extends keyof EventChannels>(channel: K, callback: EventChannels[K]) => void;
}

// Augment the global Window interface so renderer TS knows about it
declare global {
  interface Window {
    ravenforge: RavenForgeAPI;
  }
}
