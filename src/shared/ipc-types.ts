// ============================================================================
// Raven Forge Launcher — IPC Channel Type Definitions
// All communication between main ↔ renderer goes through these typed channels.
// Renderer invokes via: window.ravenforge.<domain>.<method>(args)
// Main handles via: ipcMain.handle(channel, handler)
// Main pushes via: webContents.send(channel, payload)
//
// The payload shapes live in `./ipc/`, one file per domain — this module is the
// contract itself: which channels exist, what each carries, and the shape the
// preload exposes. Everything is re-exported here, so this stays the single
// import path for the whole tree and a type does not move house when it grows.
// ============================================================================

export * from './ipc/common';
export * from './ipc/auth';
export * from './ipc/profiles';
export * from './ipc/mods';
export * from './ipc/java';
export * from './ipc/settings';
export * from './ipc/news';
export * from './ipc/game';
export * from './ipc/updater';
export * from './ipc/system';

import type { IpcResult, ProgressEvent } from './ipc/common';
import type { AuthState, MinecraftAccount } from './ipc/auth';
import type {
  LoaderVersion,
  ModLoaderType,
  MrpackExport,
  OrphanedProfile,
  WorldBackup,
  WorldBackupReason,
  Profile,
  ProfileFileSummary,
  ProfileSyncStatus,
} from './ipc/profiles';
import type {
  CataloguePack,
  ContentProjectType,
  FacetGroups,
  InstallPlan,
  InstalledMod,
  ModInstallResult,
  ModSearchFilters,
  ModSearchResult,
  ModUpdateResult,
  ModUpdateSummary,
  ShaderLoaderResult,
  ShaderLoaderState,
} from './ipc/mods';
import type { JavaInstallation, JavaProbe } from './ipc/java';
import type { GlobalSettings, TrustedKey, DataRootInfo, DataRootPlan } from './ipc/settings';
import type { Announcement, FeedResult, NewsItem } from './ipc/news';
import type { GameExitInfo, GameLogLine, LaunchOptions } from './ipc/game';
import type { ManifestVerification, UpdateCheck, UpdateInfo } from './ipc/updater';
import type { LogTail, SystemInfo } from './ipc/system';

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
  'profiles:duplicate': (profileId: string, name?: string) => Promise<IpcResult<Profile>>;
  'profiles:open-folder': (profileId: string) => Promise<IpcResult<void>>;
  'profiles:export': (profileId: string) => Promise<IpcResult<string>>; // returns JSON string
  /**
   * Write the profile out as a Modrinth modpack — the mods, not just the
   * settings. Asks where to put it; `null` means the player closed the dialog.
   */
  'profiles:export-pack': (profileId: string) => Promise<IpcResult<MrpackExport | null>>;
  'profiles:import': (json: string) => Promise<IpcResult<Profile>>;
  'profiles:get-sync-status': (profileId: string) => Promise<IpcResult<ProfileSyncStatus>>;
  /** Copy an image in as the profile's icon; `null` source clears it. */
  'profiles:set-icon': (
    profileId: string,
    sourcePath: string | null,
  ) => Promise<IpcResult<Profile>>;
  /** The profile's icon as a `data:` URL, or `null` if it has none. */
  'profiles:get-icon': (profileId: string) => Promise<IpcResult<string | null>>;
  /** World folder names in this profile's `saves/`. */
  'profiles:list-worlds': (profileId: string) => Promise<IpcResult<string[]>>;
  /** Copies of `saves/`, newest first. */
  'profiles:list-backups': (profileId: string) => Promise<IpcResult<WorldBackup[]>>;
  /**
   * Copy the worlds aside. Refused while the game holds them open.
   *
   * The reason is recorded because it decides what happens later: automatic
   * copies are pruned to the newest few, a copy taken by hand never is.
   * `before-restore` is not offered — only `restoreBackup` may claim that one.
   */
  'profiles:backup-worlds': (
    profileId: string,
    reason?: Exclude<WorldBackupReason, 'before-restore'>,
  ) => Promise<IpcResult<WorldBackup>>;
  /**
   * Put a backup's worlds back. Whatever is in `saves/` now is copied aside
   * first, and that copy comes back so the UI can say a restore is undoable.
   */
  'profiles:restore-backup': (
    profileId: string,
    backupId: string,
  ) => Promise<IpcResult<WorldBackup | null>>;
  'profiles:delete-backup': (profileId: string, backupId: string) => Promise<IpcResult<void>>;

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
  'mods:uninstall': (profileId: string, modId: string) => Promise<IpcResult<void>>;
  'mods:toggle-enabled': (
    profileId: string,
    modId: string,
    enabled: boolean,
  ) => Promise<IpcResult<void>>;
  /**
   * Ask Modrinth whether anything installed by hand has a newer build, and write
   * the answer into the lock file. Manifest-managed mods are the pack's to move.
   */
  'mods:check-updates': (profileId: string) => Promise<IpcResult<ModUpdateSummary>>;
  /** Install the builds the last check found, for the mods named. */
  'mods:update': (profileId: string, modIds: string[]) => Promise<IpcResult<ModUpdateResult>>;
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
  'java:detect-system': () => Promise<IpcResult<JavaInstallation[]>>;
  'java:probe': (binPath: string, minecraftVersion: string) => Promise<IpcResult<JavaProbe>>;

  // -- Mod Loaders --
  'loaders:get-versions': (
    loader: ModLoaderType,
    mcVersion: string,
  ) => Promise<IpcResult<LoaderVersion[]>>;

  // -- Game Launch --
  'game:launch': (options: LaunchOptions) => Promise<IpcResult<void>>;
  'game:kill': (profileId: string) => Promise<IpcResult<void>>;
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
  'settings:get-data-root': () => Promise<IpcResult<DataRootInfo>>;
  /** Opens a directory picker; `null` when it was dismissed. */
  'settings:choose-data-root': () => Promise<IpcResult<DataRootPlan | null>>;
  'settings:plan-data-root': (target: string) => Promise<IpcResult<DataRootPlan>>;
  /** Moves the data and restarts the launcher into the new location. */
  'settings:apply-data-root': (target: string) => Promise<IpcResult<void>>;

  // -- News & Announcements --
  'news:get': () => Promise<IpcResult<FeedResult<NewsItem>>>;
  'news:refresh': () => Promise<IpcResult<FeedResult<NewsItem>>>;
  'announcements:get': () => Promise<IpcResult<FeedResult<Announcement>>>;
  'announcements:refresh': () => Promise<IpcResult<FeedResult<Announcement>>>;

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
  'system:select-file': (
    filters?: { name: string; extensions: string[] }[],
  ) => Promise<IpcResult<string | null>>;
  'system:get-logs-path': () => Promise<IpcResult<string>>;
  /** Tail the launcher's own log. Returns oldest-first lines, newest last. */
  'system:read-log': (lines?: number, since?: number) => Promise<IpcResult<LogTail>>;

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
  'progress:loader-install': (event: ProgressEvent) => void;
  'progress:java-download': (event: ProgressEvent) => void;
  'progress:game-assets': (event: ProgressEvent) => void;
  'progress:launcher-update': (event: ProgressEvent) => void;
  'progress:data-root': (event: ProgressEvent) => void;

  // -- Game Events --
  'game:log': (profileId: string, line: GameLogLine) => void;
  'game:started': (profileId: string) => void;
  'game:exited': (info: GameExitInfo) => void;

  // -- Auth Events --
  'auth:state-changed': (state: AuthState) => void;

  // -- Profile Events --
  'profiles:sync-status-changed': (status: ProfileSyncStatus) => void;

  // -- Updater Events --
  'updater:update-available': (info: UpdateInfo) => void;
  'updater:update-downloaded': (info: UpdateInfo) => void;
  // -- Announcement Events --

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
    create: InvokeChannels['profiles:create'];
    update: InvokeChannels['profiles:update'];
    delete: InvokeChannels['profiles:delete'];
    getFileSummary: InvokeChannels['profiles:get-file-summary'];
    listOrphaned: InvokeChannels['profiles:list-orphaned'];
    adoptOrphaned: InvokeChannels['profiles:adopt-orphaned'];
    discardOrphaned: InvokeChannels['profiles:discard-orphaned'];
    duplicate: InvokeChannels['profiles:duplicate'];
    openFolder: InvokeChannels['profiles:open-folder'];
    export: InvokeChannels['profiles:export'];
    exportPack: InvokeChannels['profiles:export-pack'];
    import: InvokeChannels['profiles:import'];
    getSyncStatus: InvokeChannels['profiles:get-sync-status'];
    setIcon: InvokeChannels['profiles:set-icon'];
    getIcon: InvokeChannels['profiles:get-icon'];
    listWorlds: InvokeChannels['profiles:list-worlds'];
    listBackups: InvokeChannels['profiles:list-backups'];
    backupWorlds: InvokeChannels['profiles:backup-worlds'];
    restoreBackup: InvokeChannels['profiles:restore-backup'];
    deleteBackup: InvokeChannels['profiles:delete-backup'];
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
    uninstall: InvokeChannels['mods:uninstall'];
    toggleEnabled: InvokeChannels['mods:toggle-enabled'];
    checkUpdates: InvokeChannels['mods:check-updates'];
    update: InvokeChannels['mods:update'];
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
    detectSystem: InvokeChannels['java:detect-system'];
    probe: InvokeChannels['java:probe'];
  };
  loaders: {
    getVersions: InvokeChannels['loaders:get-versions'];
  };
  game: {
    launch: InvokeChannels['game:launch'];
    kill: InvokeChannels['game:kill'];
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
    getDataRoot: InvokeChannels['settings:get-data-root'];
    chooseDataRoot: InvokeChannels['settings:choose-data-root'];
    planDataRoot: InvokeChannels['settings:plan-data-root'];
    applyDataRoot: InvokeChannels['settings:apply-data-root'];
  };
  news: {
    get: InvokeChannels['news:get'];
    refresh: InvokeChannels['news:refresh'];
  };
  announcements: {
    get: InvokeChannels['announcements:get'];
    refresh: InvokeChannels['announcements:refresh'];
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
  /**
   * Subscribe to a main-process event; call the returned function to stop.
   *
   * The disposer is the whole interface on purpose. An `off(channel, callback)`
   * cannot work here: a function handed across the context bridge arrives in the
   * preload as a fresh proxy every time it crosses, so the callback `off` gets
   * is never the object `on` recorded, and the listener stays attached forever.
   * Handing back the one thing that already knows which registration it is
   * removes the possibility.
   */
  on: <K extends keyof EventChannels>(channel: K, callback: EventChannels[K]) => () => void;
}

// Augment the global Window interface so renderer TS knows about it
declare global {
  interface Window {
    ravenforge: RavenForgeAPI;
  }
}
