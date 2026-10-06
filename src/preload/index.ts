// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { contextBridge, ipcRenderer } from 'electron';
import type { RavenForgeAPI, EventChannels } from '../shared/ipc-types';

/**
 * Typed preload API exposed to renderer via contextBridge.
 * All IPC calls go through ipcRenderer.invoke (request/response)
 * and ipcRenderer.on (event subscriptions).
 *
 * SECURITY: Only typed channels are exposed. No raw Node.js APIs.
 */
const api: RavenForgeAPI = {
  auth: {
    loginMicrosoft: () => ipcRenderer.invoke('auth:login-microsoft'),
    loginOffline: (username) => ipcRenderer.invoke('auth:login-offline', username),
    logout: (accountId) => ipcRenderer.invoke('auth:logout', accountId),
    getState: () => ipcRenderer.invoke('auth:get-state'),
    setActive: (accountId) => ipcRenderer.invoke('auth:set-active', accountId),
  },
  profiles: {
    getAll: () => ipcRenderer.invoke('profiles:get-all'),
    create: (profile) => ipcRenderer.invoke('profiles:create', profile),
    update: (profileId, updates) => ipcRenderer.invoke('profiles:update', profileId, updates),
    delete: (profileId, deleteFiles) =>
      ipcRenderer.invoke('profiles:delete', profileId, deleteFiles),
    getFileSummary: (profileId) => ipcRenderer.invoke('profiles:get-file-summary', profileId),
    listOrphaned: () => ipcRenderer.invoke('profiles:list-orphaned'),
    adoptOrphaned: (profileId) => ipcRenderer.invoke('profiles:adopt-orphaned', profileId),
    discardOrphaned: (profileId) => ipcRenderer.invoke('profiles:discard-orphaned', profileId),
    duplicate: (profileId, name) => ipcRenderer.invoke('profiles:duplicate', profileId, name),
    openFolder: (profileId) => ipcRenderer.invoke('profiles:open-folder', profileId),
    export: (profileId) => ipcRenderer.invoke('profiles:export', profileId),
    exportPack: (profileId, options) =>
      ipcRenderer.invoke('profiles:export-pack', profileId, options),
    import: () => ipcRenderer.invoke('profiles:import'),
    getSyncStatus: (profileId) => ipcRenderer.invoke('profiles:get-sync-status', profileId),
    setIcon: (profileId, sourcePath) =>
      ipcRenderer.invoke('profiles:set-icon', profileId, sourcePath),
    getIcon: (profileId) => ipcRenderer.invoke('profiles:get-icon', profileId),
    listWorlds: (profileId) => ipcRenderer.invoke('profiles:list-worlds', profileId),
    listBackups: (profileId) => ipcRenderer.invoke('profiles:list-backups', profileId),
    backupWorlds: (profileId, reason) =>
      ipcRenderer.invoke('profiles:backup-worlds', profileId, reason),
    restoreBackup: (profileId, backupId) =>
      ipcRenderer.invoke('profiles:restore-backup', profileId, backupId),
    deleteBackup: (profileId, backupId) =>
      ipcRenderer.invoke('profiles:delete-backup', profileId, backupId),
  },
  packs: {
    listCatalogue: () => ipcRenderer.invoke('packs:list-catalogue'),
    createFromManifest: (url) => ipcRenderer.invoke('packs:create-from-manifest', url),
    createFromUrl: (url) => ipcRenderer.invoke('packs:create-from-url', url),
    importMrpack: (filePath) => ipcRenderer.invoke('packs:import-mrpack', filePath),
    installModrinth: (pack, wanted) => ipcRenderer.invoke('packs:install-modrinth', pack, wanted),
  },
  mods: {
    getInstalled: (profileId) => ipcRenderer.invoke('mods:get-installed', profileId),
    syncManifest: (profileId) => ipcRenderer.invoke('mods:sync-manifest', profileId),
    installFromSearch: (profileId, mod, version) =>
      ipcRenderer.invoke('mods:install-from-search', profileId, mod, version),
    addFromFile: (profileId) => ipcRenderer.invoke('mods:add-from-file', profileId),
    checkInstall: (profileId, mod) => ipcRenderer.invoke('mods:check-install', profileId, mod),
    uninstall: (profileId, modId) => ipcRenderer.invoke('mods:uninstall', profileId, modId),
    toggleEnabled: (profileId, modId, enabled) =>
      ipcRenderer.invoke('mods:toggle-enabled', profileId, modId, enabled),
    checkUpdates: (profileId) => ipcRenderer.invoke('mods:check-updates', profileId),
    update: (profileId, modIds) => ipcRenderer.invoke('mods:update', profileId, modIds),
    search: (filters) => ipcRenderer.invoke('mods:search', filters),
    getDetails: (ids) => ipcRenderer.invoke('mods:get-details', ids),
    getFacets: (projectType) => ipcRenderer.invoke('mods:get-facets', projectType),
  },
  content: {
    getShaders: (profileId) => ipcRenderer.invoke('content:get-shaders', profileId),
    getResourcePacks: (profileId) => ipcRenderer.invoke('content:get-resourcepacks', profileId),
    installShader: (profileId, projectId, version) =>
      ipcRenderer.invoke('content:install-shader', profileId, projectId, version),
    checkInstall: (profileId, item) => ipcRenderer.invoke('content:check-install', profileId, item),
    getShaderLoaderState: (profileId) =>
      ipcRenderer.invoke('content:get-shader-loader-state', profileId),
    installShaderLoader: (profileId, projectId) =>
      ipcRenderer.invoke('content:install-shader-loader', profileId, projectId),
    installResourcePack: (profileId, projectId, version) =>
      ipcRenderer.invoke('content:install-resourcepack', profileId, projectId, version),
    removeShader: (profileId, id) => ipcRenderer.invoke('content:remove-shader', profileId, id),
    removeResourcePack: (profileId, id) =>
      ipcRenderer.invoke('content:remove-resourcepack', profileId, id),
    addFromFile: (profileId, kind) => ipcRenderer.invoke('content:add-from-file', profileId, kind),
    reorderResourcePacks: (profileId, orderedIds) =>
      ipcRenderer.invoke('content:reorder-resourcepacks', profileId, orderedIds),
  },
  java: {
    detectSystem: () => ipcRenderer.invoke('java:detect-system'),
    probe: (binPath, minecraftVersion) =>
      ipcRenderer.invoke('java:probe', binPath, minecraftVersion),
  },
  loaders: {
    getVersions: (loader, mcVersion) =>
      ipcRenderer.invoke('loaders:get-versions', loader, mcVersion),
  },
  game: {
    launch: (options) => ipcRenderer.invoke('game:launch', options),
    kill: (profileId) => ipcRenderer.invoke('game:kill', profileId),
    getRunning: () => ipcRenderer.invoke('game:get-running'),
    getLogTail: (profileId) => ipcRenderer.invoke('game:get-log-tail', profileId),
    getVersions: (includeSnapshots) => ipcRenderer.invoke('game:get-versions', includeSnapshots),
    cancel: (profileId) => ipcRenderer.invoke('game:cancel', profileId),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (updates) => ipcRenderer.invoke('settings:update', updates),
    reset: () => ipcRenderer.invoke('settings:reset'),
    addTrustedKey: (key) => ipcRenderer.invoke('settings:add-trusted-key', key),
    removeTrustedKey: (publicKey) => ipcRenderer.invoke('settings:remove-trusted-key', publicKey),
    getDataRoot: () => ipcRenderer.invoke('settings:get-data-root'),
    chooseDataRoot: () => ipcRenderer.invoke('settings:choose-data-root'),
    planDataRoot: (target) => ipcRenderer.invoke('settings:plan-data-root', target),
    applyDataRoot: (target) => ipcRenderer.invoke('settings:apply-data-root', target),
    forgetDataRoot: () => ipcRenderer.invoke('settings:forget-data-root'),
  },
  news: {
    get: () => ipcRenderer.invoke('news:get'),
    refresh: () => ipcRenderer.invoke('news:refresh'),
  },
  announcements: {
    get: () => ipcRenderer.invoke('announcements:get'),
    refresh: () => ipcRenderer.invoke('announcements:refresh'),
  },
  manifest: {
    verify: (profileId) => ipcRenderer.invoke('manifest:verify', profileId),
  },
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
  },
  system: {
    getInfo: () => ipcRenderer.invoke('system:get-info'),
    getStorage: () => ipcRenderer.invoke('system:get-storage'),
    relaunch: () => ipcRenderer.invoke('system:relaunch'),
    openPath: (p) => ipcRenderer.invoke('system:open-path', p),
    openUrl: (url) => ipcRenderer.invoke('system:open-url', url),
    selectFile: (filters) => ipcRenderer.invoke('system:select-file', filters),
    getLogsPath: () => ipcRenderer.invoke('system:get-logs-path'),
    readLog: (lines, since) => ipcRenderer.invoke('system:read-log', lines, since),
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  },

  /**
   * Subscribe, and hand back the only reliable way to unsubscribe.
   *
   * A callback crossing the context bridge is proxied afresh on every crossing,
   * so the object this function receives is not the object a later `off` would
   * receive — matching them up, by identity or by a lookup table keyed on them,
   * cannot work. The closure below is the registration, so nothing has to be
   * matched at all.
   */
  on: <K extends keyof EventChannels>(channel: K, callback: EventChannels[K]) => {
    // Wrap the callback to strip the IpcRendererEvent first argument
    const wrapper = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => {
      (callback as (...a: unknown[]) => void)(...args);
    };
    ipcRenderer.on(channel, wrapper);
    return () => ipcRenderer.removeListener(channel, wrapper);
  },
};

contextBridge.exposeInMainWorld('ravenforge', api);
