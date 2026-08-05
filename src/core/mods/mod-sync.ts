import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { log } from '../../main/logger';
import {
  beginJob,
  endJob,
  isCancellation,
  throwIfCancelled,
  withTimeout,
} from '../util/cancellation';
import { paths } from '../config/paths';
import { getSettings } from '../config/settings-manager';
import { getProfile } from '../profiles/profile-manager';
import {
  getModVersions,
  getProjectTitle,
  getVersion,
  primaryFile,
  type ModrinthVersion,
} from './modrinth-api';
import { requiredDependencies } from './compatibility';
import { acceptedLoaders } from '../../shared/constants';
import { downloadToFile } from '../net/download';
import { syncContentFromManifest } from './content-manager';
import { sha256File, fileMatches, verifyDownload, type HashedEntry } from './integrity';
import { getMainWindow } from '../../main/window';
import { modManifestSchema, type ModEntry, type ModManifest } from '../../shared/manifest-schema';
import type {
  InstalledMod,
  ModInstallResult,
  ProfileSyncStatus,
  ModSearchResult,
  ProgressEvent,
} from '../../shared/ipc-types';

function emitProgress(
  channel: 'progress:mod-sync' | 'progress:mod-download',
  event: ProgressEvent,
): void {
  getMainWindow()?.webContents.send(channel, event);
}

// ── Lock file (installed.lock) ─────────────────────────────
// JSON array of InstalledMod stored per-profile

async function readLockFile(profileId: string): Promise<InstalledMod[]> {
  const lockPath = paths.profileLockFile(profileId);
  try {
    const raw = await fs.readFile(lockPath, 'utf-8');
    return JSON.parse(raw) as InstalledMod[];
  } catch {
    return [];
  }
}

async function writeLockFile(profileId: string, mods: InstalledMod[]): Promise<void> {
  const lockPath = paths.profileLockFile(profileId);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(lockPath, JSON.stringify(mods, null, 2), 'utf-8');
}

// ── Sync state (ETag + last result), persisted per profile ─

interface SyncState {
  lastSyncedAt?: string;
  manifestEtag?: string;
  pendingUpdates: number;
  status: ProfileSyncStatus['status'];
  errorMessage?: string;
}

async function readSyncState(profileId: string): Promise<SyncState> {
  try {
    const raw = await fs.readFile(paths.profileSyncStateFile(profileId), 'utf-8');
    return JSON.parse(raw) as SyncState;
  } catch {
    return { pendingUpdates: 0, status: 'never-synced' };
  }
}

async function writeSyncState(profileId: string, state: SyncState): Promise<void> {
  const file = paths.profileSyncStateFile(profileId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(state, null, 2), 'utf-8');

  const status: ProfileSyncStatus = { profileId, ...state };
  getMainWindow()?.webContents.send('profiles:sync-status-changed', status);
}

// ── Manifest cache ─────────────────────────────────────────
// The ETag alone is not enough state to work with. A 304 means "you already
// have this" — but without the body there is nothing to reconcile the profile
// against, so the sync used to return early and report success while a jar the
// player deleted by hand stayed missing. Caching the last body that validated
// fixes that, and is also what makes a sync possible with no network at all.

async function readCachedManifest(profileId: string): Promise<ModManifest | null> {
  try {
    const raw = await fs.readFile(paths.profileManifestCacheFile(profileId), 'utf-8');
    const parsed = modManifestSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function writeCachedManifest(profileId: string, manifest: ModManifest): Promise<void> {
  const file = paths.profileManifestCacheFile(profileId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(manifest, null, 2), 'utf-8');
}

// ── Helpers ────────────────────────────────────────────────

// Hashing helpers live in ./integrity so content-manager can share them
// without importing this module back.

// ── Public API ─────────────────────────────────────────────

export async function getInstalledMods(profileId: string): Promise<InstalledMod[]> {
  return readLockFile(profileId);
}

export async function getProfileSyncStatus(profileId: string): Promise<ProfileSyncStatus> {
  const profile = await getProfile(profileId);
  if (!profile) {
    return { profileId, pendingUpdates: 0, status: 'error', errorMessage: 'Profile not found' };
  }
  if (!profile.manifestUrl) {
    return { profileId, pendingUpdates: 0, status: 'never-synced' };
  }

  return { profileId, ...(await readSyncState(profileId)) };
}

// ── Manifest entry resolution ──────────────────────────────

interface ResolvedDownload {
  url?: string;
  /** Set instead of `url` for `source: "local"` entries */
  localPath?: string;
  fileName: string;
  version: string;
  /**
   * Integrity data the source API supplied, used only where the manifest itself
   * published none. A manifest hash is the stronger claim — it can be covered
   * by the manifest signature, whereas this one is whatever the API said today.
   */
  hashes?: HashedEntry;
}

/**
 * Turn a manifest entry into something downloadable.
 *
 * `modrinth` entries carry a project ID plus a version label; the label is
 * matched against Modrinth's `version_number` first and its opaque version `id`
 * second, so manifests can pin either.
 */
async function resolveModEntry(entry: ModEntry, manifest: ModManifest): Promise<ResolvedDownload> {
  // Fast path: a manifest that already carries the direct download URL needs no
  // API lookup at all. Pack generators emit this, so syncing a 100-mod pack
  // costs zero Modrinth requests and stays resolvable even if the API is down.
  if (entry.url && entry.source !== 'local') {
    const fileName =
      entry.fileName ?? path.basename(new URL(entry.url).pathname) ?? `${entry.id}.jar`;
    return { url: entry.url, fileName, version: entry.version };
  }

  switch (entry.source) {
    case 'modrinth': {
      if (!entry.projectId) {
        throw new Error(`${entry.name}: source "modrinth" requires projectId or url`);
      }
      const loaders = acceptedLoaders(manifest.modLoader);
      const versions = await getModVersions(entry.projectId, manifest.minecraftVersion, loaders);
      const match =
        versions.find((v) => v.version_number === entry.version || v.id === entry.version) ??
        versions[0];
      if (!match) {
        throw new Error(
          `${entry.name}: no Modrinth release for MC ${manifest.minecraftVersion} / ${manifest.modLoader}`,
        );
      }
      const file = primaryFile(match);
      return { url: file.url, fileName: file.filename, version: match.version_number || match.id };
    }

    case 'url':
      // Handled by the fast path above; reaching here means `url` was absent.
      throw new Error(`${entry.name}: source "url" requires url`);

    case 'local': {
      if (!entry.localPath) throw new Error(`${entry.name}: source "local" requires localPath`);
      return {
        localPath: entry.localPath,
        fileName: path.basename(entry.localPath),
        version: entry.version,
      };
    }
  }
}

/** Download (or copy) one entry into the profile and verify its hash. */
async function fetchModEntry(
  entry: ModEntry,
  resolved: ResolvedDownload,
  destPath: string,
  signal?: AbortSignal,
): Promise<string> {
  if (resolved.localPath) {
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.copyFile(resolved.localPath, destPath);
  } else {
    await downloadToFile(resolved.url!, destPath, signal);
  }

  // The manifest's own hashes win — `expectedHash` prefers sha512, then sha256,
  // then sha1, so spreading the entry last cannot downgrade a manifest-declared
  // hash to whatever the source's API happened to report.
  await verifyDownload(destPath, { ...resolved.hashes, ...entry }, entry.name);

  // installed.lock always records sha256 so local integrity checks stay uniform,
  // whichever algorithm the manifest happened to publish.
  return sha256File(destPath);
}

// ── Manifest sync ──────────────────────────────────────────

function parseManifest(body: unknown, profileName: string): ModManifest {
  const parsed = modManifestSchema.safeParse(body);
  if (parsed.success) return parsed.data;

  log.error(`Manifest validation failed for ${profileName}:`, parsed.error.issues);
  throw new Error(
    "The server's manifest is malformed or incompatible — " +
      parsed.error.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join('; '),
  );
}

/**
 * Get the manifest to reconcile against, and the ETag to remember.
 *
 * Three ways in, in order of preference: a fresh 200, the cached copy when the
 * server says 304, and the cached copy again when the network is gone entirely.
 * Only the first can change what is installed; the other two exist so that a
 * sync still checks the profile against the mod list it is supposed to match.
 */
async function obtainManifest(
  profileId: string,
  profileName: string,
  manifestUrl: string,
  knownEtag: string | undefined,
  signal: AbortSignal,
): Promise<{ manifest: ModManifest; etag: string | undefined }> {
  const headers: Record<string, string> = {};
  if (knownEtag) headers['If-None-Match'] = knownEtag;

  let res: Response;
  try {
    res = await fetch(manifestUrl, { headers, signal: withTimeout(signal, 15000) });
  } catch (err) {
    // Offline, or the manifest host is down. Falling back to the last manifest
    // that validated beats failing the sync outright: the player can still
    // reconcile and launch. Cancellation is not a network failure — let it pass.
    if (isCancellation(err)) throw err;
    const cached = await readCachedManifest(profileId);
    if (!cached) throw err;
    log.warn(`Manifest fetch failed for ${profileName} — using the cached manifest`);
    return { manifest: cached, etag: knownEtag };
  }

  if (res.status === 304) {
    // A 304 body is empty by definition, so the cached copy is the only thing
    // there is to reconcile against. Without one, drop the conditional header
    // and ask again rather than reporting a sync that checked nothing.
    const cached = await readCachedManifest(profileId);
    if (cached) {
      log.info(`Manifest unchanged (304) for ${profileName} — reconciling local files`);
      return { manifest: cached, etag: knownEtag };
    }
    log.info(`Manifest unchanged (304) for ${profileName} but nothing cached — refetching`);
    res = await fetch(manifestUrl, { signal: withTimeout(signal, 15000) });
  }

  if (!res.ok) throw new Error(`Failed to fetch manifest: ${res.status} ${res.statusText}`);

  const manifest = parseManifest(await res.json(), profileName);
  await writeCachedManifest(profileId, manifest);
  return { manifest, etag: res.headers.get('etag') ?? knownEtag };
}

export async function syncManifest(profileId: string): Promise<void> {
  const profile = await getProfile(profileId);
  if (!profile) throw new Error(`Profile ${profileId} not found`);
  if (!profile.manifestUrl) throw new Error('Profile has no manifest URL configured');

  log.info(`Syncing manifest for profile ${profile.name}: ${profile.manifestUrl}`);

  // A modpack sync is a long download; let the user call it off.
  const signal = beginJob(profileId);
  const previousState = await readSyncState(profileId);

  try {
    const { manifest, etag } = await obtainManifest(
      profileId,
      profile.name,
      profile.manifestUrl,
      previousState.manifestEtag,
      signal,
    );

    if (manifest.minecraftVersion !== profile.minecraftVersion) {
      log.warn(
        `Manifest targets MC ${manifest.minecraftVersion} but profile ${profile.name} is pinned to ${profile.minecraftVersion}`,
      );
    }

    const settings = await getSettings();
    const modsDir = paths.profileModsDir(profileId);
    await fs.mkdir(modsDir, { recursive: true });

    // Client-side sync: server-only mods are not installed into a player instance.
    const entries = manifest.mods.filter((m) => m.side === 'client' || m.side === 'both');
    const existing = await readLockFile(profileId);
    const userInstalled = existing.filter((m) => !m.fromManifest);
    const synced: InstalledMod[] = [];

    const total = entries.length + manifest.configFiles.length;
    let done = 0;

    const report = (message: string, currentFile?: string) =>
      emitProgress('progress:mod-sync', {
        operationId: profileId,
        progress: total > 0 ? done / total : 1,
        message,
        currentFile,
        filesCompleted: done,
        filesTotal: total,
      });

    report(`Synchronizacja ${profile.name}…`);

    for (const entry of entries) {
      throwIfCancelled(signal, 'Sync');
      report(entry.name);

      const previous = existing.find((m) => m.id === entry.id);
      const resolved = await resolveModEntry(entry, manifest);
      const destPath = path.join(modsDir, resolved.fileName);

      // Already on disk and matching the manifest hash — leave it alone.
      let hash: string | undefined;
      if (previous && (await fileMatches(destPath, entry))) {
        hash = previous.sha256 ?? (await sha256File(destPath));
      }

      if (!hash) {
        log.info(`Downloading mod: ${entry.name} (${resolved.fileName})`);
        hash = await fetchModEntry(entry, resolved, destPath, signal);

        // A version bump changes the filename; drop the file it replaced.
        if (previous && previous.fileName !== resolved.fileName) {
          try {
            await fs.rm(path.join(modsDir, previous.fileName), { force: true });
          } catch {
            /* ok */
          }
        }
      }

      synced.push({
        id: entry.id,
        name: entry.name,
        version: resolved.version,
        source: entry.source,
        fileName: resolved.fileName,
        sha256: hash,
        required: entry.required,
        side: entry.side,
        enabled: previous?.enabled ?? true,
        fromManifest: true,
      });
      done++;
    }

    // Config overrides, resolved relative to the profile's .minecraft directory.
    for (const config of manifest.configFiles) {
      report(config.path, config.path);

      const dest = path.join(paths.profileGameDir(profileId), config.path);
      const relative = path.relative(paths.profileGameDir(profileId), dest);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`Manifest config path escapes the game directory: ${config.path}`);
      }

      if (!(await fileMatches(dest, config))) {
        await downloadToFile(config.url, dest, signal);
        await verifyDownload(dest, config, `config ${config.path}`);
        log.info(`Applied config override: ${config.path}`);
      }
      done++;
    }

    const mcVersion = manifest.minecraftVersion;
    await syncContentFromManifest('resourcepacks', profileId, manifest.resourcePacks, mcVersion);
    await syncContentFromManifest('shaders', profileId, manifest.shaders, mcVersion);

    // Mods that were installed from a previous manifest but are gone from this one.
    const keptIds = new Set(synced.map((m) => m.id));
    const orphaned = existing.filter((m) => m.fromManifest && !keptIds.has(m.id));

    if (settings.autoRemoveOrphanedMods) {
      for (const stale of orphaned) {
        try {
          await fs.rm(path.join(modsDir, stale.fileName), { force: true });
        } catch {
          /* ok */
        }
        log.info(`Removed orphaned mod ${stale.name} from profile ${profile.name}`);
      }
      await writeLockFile(profileId, [...synced, ...userInstalled]);
    } else {
      // Keep them installed and surface the count so the UI can prompt.
      await writeLockFile(profileId, [...synced, ...orphaned, ...userInstalled]);
    }

    const pendingUpdates = settings.autoRemoveOrphanedMods ? 0 : orphaned.length;

    await writeSyncState(profileId, {
      lastSyncedAt: new Date().toISOString(),
      manifestEtag: etag ?? undefined,
      pendingUpdates,
      status: pendingUpdates > 0 ? 'updates-available' : 'synced',
    });

    emitProgress('progress:mod-sync', {
      operationId: profileId,
      progress: 1,
      message: `Zsynchronizowano ${synced.length} modów`,
      filesCompleted: total,
      filesTotal: total,
    });
    log.info(
      `Manifest sync complete for ${profile.name}: ${synced.length} mods, ` +
        `${manifest.configFiles.length} configs, ${orphaned.length} orphaned`,
    );
  } catch (err) {
    // A cancelled sync is not an error state — leave the profile as it was
    // rather than flagging it red for a choice the user made deliberately.
    if (isCancellation(err)) {
      log.info(`Manifest sync cancelled for ${profile.name}`);
      await writeSyncState(profileId, previousState);
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    await writeSyncState(profileId, {
      ...previousState,
      status: 'error',
      errorMessage: message,
    });
    throw err;
  } finally {
    endJob(profileId);
  }
}

/**
 * Pick the build to install for a search result.
 *
 * With a `versionId` the caller has already decided — the compatibility check
 * resolves one, and the player may have accepted a warning about that exact
 * build — so it is fetched by id rather than looked for in a filtered list it
 * would be missing from by definition.
 *
 * Without one, the profile decides. The argument is optional because
 * `ModSearchResult.versions` holds *game* versions, so the renderer has no build
 * id to hand over; passing `versions[0]` (as it once did) asked Modrinth for a
 * version called "1.21.4".
 */
async function resolveInstallVersion(
  profileId: string,
  mod: ModSearchResult,
  versionId?: string,
): Promise<ModrinthVersion> {
  if (versionId) return getVersion(versionId);

  const profile = await getProfile(profileId);
  const gameVersion = profile?.minecraftVersion;
  const loaders = profile ? acceptedLoaders(profile.modLoader) : [];

  const versions = await getModVersions(mod.id, gameVersion, loaders);
  if (!versions[0]) {
    throw new Error(
      `No Modrinth release for ${mod.name} on MC ${gameVersion ?? 'any'} / ` +
        `${loaders.join(' or ') || 'any loader'}`,
    );
  }
  return versions[0];
}

/** A resolved build, as the download path wants it. */
function downloadFor(version: ModrinthVersion): {
  url: string;
  fileName: string;
  version: string;
  hashes: HashedEntry;
} {
  const file = primaryFile(version);
  return {
    url: file.url,
    fileName: file.filename,
    version: version.version_number || version.id,
    hashes: { sha512: file.hashes.sha512 },
  };
}

/** Download, verify and record one already-resolved file. */
async function installResolvedMod(
  profileId: string,
  identity: { id: string; name: string; source: InstalledMod['source'] },
  resolved: { url: string; fileName: string; version: string; hashes: HashedEntry },
): Promise<InstalledMod> {
  const modsDir = paths.profileModsDir(profileId);
  await fs.mkdir(modsDir, { recursive: true });
  const destPath = path.join(modsDir, resolved.fileName);

  log.info(`Installing mod ${identity.name} (${resolved.fileName}) from ${identity.source}`);
  await downloadToFile(resolved.url, destPath);

  // Deletes the file and throws on mismatch. Modrinth supplies sha512; a
  // manifest may supply any of sha512/sha256/sha1. An entry that supplies none
  // is installed unverified, which is why nothing here invents a hash to check
  // against.
  await verifyDownload(destPath, resolved.hashes, identity.name);

  // installed.lock always records sha256, whatever the source published.
  const hash = await sha256File(destPath);

  const installed: InstalledMod = {
    id: identity.id,
    name: identity.name,
    version: resolved.version,
    source: identity.source,
    fileName: resolved.fileName,
    sha256: hash,
    required: false,
    side: 'both',
    enabled: true,
    fromManifest: false,
  };

  const mods = await readLockFile(profileId);
  const idx = mods.findIndex((m) => m.id === identity.id);
  if (idx >= 0) {
    // Remove old file
    try {
      await fs.rm(path.join(modsDir, mods[idx].fileName), { force: true });
    } catch {
      /* ok */
    }
    mods[idx] = installed;
  } else {
    mods.push(installed);
  }
  await writeLockFile(profileId, mods);

  return installed;
}

/**
 * Install a mod, and whatever it cannot start without.
 *
 * The dependencies are the point. A mod whose required API is missing does not
 * fail to install — it installs perfectly and then takes the game down during
 * startup, which is the single most common way a working profile stops working.
 * Their names come back so the UI can say what arrived unasked.
 */
export async function installModFromSearch(
  profileId: string,
  mod: ModSearchResult,
  versionId?: string,
): Promise<ModInstallResult> {
  const version = await resolveInstallVersion(profileId, mod, versionId);
  const installed = await installResolvedMod(
    profileId,
    { id: mod.id, name: mod.name, source: 'modrinth' },
    downloadFor(version),
  );
  return { mod: installed, dependencies: await installRequiredDependencies(profileId, version) };
}

/**
 * Install one specific Modrinth version, chosen by the caller rather than by
 * the profile. Used to bootstrap the shader loader, where the version has
 * already been matched against the profile's Minecraft version and loader.
 */
export async function installModrinthVersion(
  profileId: string,
  projectId: string,
  displayName: string,
  version: ModrinthVersion,
): Promise<InstalledMod> {
  return installResolvedMod(
    profileId,
    { id: projectId, name: displayName, source: 'modrinth' },
    downloadFor(version),
  );
}

/**
 * Install a build's missing required dependencies into the profile.
 *
 * Resolved against the profile rather than against the pin where the two
 * disagree: a `version_id` the publisher named is honoured when it fits this
 * Minecraft version, and the newest build that does fit is used when it does
 * not. A dependency with no usable build is logged and skipped — the
 * compatibility check reports that case before anything is downloaded, and
 * failing here would leave the mod itself installed and the profile half done.
 *
 * Returns the names it added, in order.
 */
export async function installRequiredDependencies(
  profileId: string,
  version: ModrinthVersion,
): Promise<string[]> {
  const profile = await getProfile(profileId);
  if (!profile) return [];

  const loaders = acceptedLoaders(profile.modLoader);
  const installed = await readLockFile(profileId);
  const added: string[] = [];

  for (const dep of requiredDependencies(version, installed)) {
    const candidates = await getModVersions(dep.projectId, profile.minecraftVersion, loaders);
    const match = dep.versionId
      ? (candidates.find((v) => v.id === dep.versionId) ?? candidates[0])
      : candidates[0];
    if (!match) {
      log.warn(`Dependency ${dep.projectId} has no build for MC ${profile.minecraftVersion}`);
      continue;
    }

    // The project's title, not the build's — `ModrinthVersion.name` is a label
    // like "[1.21.4] Sodium 0.6.5", which reads badly in a sentence.
    const name = await getProjectTitle(dep.projectId);
    await installModrinthVersion(profileId, dep.projectId, name, match);
    added.push(name);
  }

  return added;
}

export async function installModFromFile(
  profileId: string,
  filePath: string,
): Promise<InstalledMod> {
  const modsDir = paths.profileModsDir(profileId);
  await fs.mkdir(modsDir, { recursive: true });

  const fileName = path.basename(filePath);
  const destPath = path.join(modsDir, fileName);

  await fs.copyFile(filePath, destPath);
  const hash = await sha256File(destPath);

  const installed: InstalledMod = {
    id: `local-${crypto.randomUUID()}`,
    name: fileName.replace(/\.jar$/i, ''),
    version: 'local',
    source: 'local',
    fileName,
    sha256: hash,
    required: false,
    side: 'both',
    enabled: true,
    fromManifest: false,
  };

  const mods = await readLockFile(profileId);
  mods.push(installed);
  await writeLockFile(profileId, mods);

  return installed;
}

export async function uninstallMod(profileId: string, modId: string): Promise<void> {
  const modsDir = paths.profileModsDir(profileId);
  const mods = await readLockFile(profileId);
  const mod = mods.find((m) => m.id === modId);
  if (!mod) throw new Error(`Mod ${modId} not found in profile ${profileId}`);

  // Delete file
  const filePath = mod.enabled
    ? path.join(modsDir, mod.fileName)
    : path.join(modsDir, `${mod.fileName}.disabled`);
  try {
    await fs.rm(filePath, { force: true });
  } catch {
    /* ok */
  }

  const updatedMods = mods.filter((m) => m.id !== modId);
  await writeLockFile(profileId, updatedMods);
  log.info(`Uninstalled mod ${mod.name} from profile ${profileId}`);
}

export async function toggleModEnabled(
  profileId: string,
  modId: string,
  enabled: boolean,
): Promise<void> {
  const modsDir = paths.profileModsDir(profileId);
  const mods = await readLockFile(profileId);
  const mod = mods.find((m) => m.id === modId);
  if (!mod) throw new Error(`Mod ${modId} not found`);

  if (mod.enabled === enabled) return;

  const currentPath = mod.enabled
    ? path.join(modsDir, mod.fileName)
    : path.join(modsDir, `${mod.fileName}.disabled`);
  const newPath = enabled
    ? path.join(modsDir, mod.fileName)
    : path.join(modsDir, `${mod.fileName}.disabled`);

  await fs.rename(currentPath, newPath);
  mod.enabled = enabled;
  await writeLockFile(profileId, mods);
  log.info(`${enabled ? 'Enabled' : 'Disabled'} mod ${mod.name} in profile ${profileId}`);
}
