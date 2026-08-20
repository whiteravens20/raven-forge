import fs from 'node:fs/promises';
import path from 'node:path';
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
import { getAllProfiles, getProfile } from '../profiles/profile-manager';
import {
  getModVersions,
  getProjectTitle,
  getVersion,
  primaryFile,
  type ModrinthVersion,
} from './modrinth-api';
import { readLockFile, mutateLockFile, modFilePath } from './lock-file';
import { requiredDependencies } from './compatibility';
import { acceptedLoaders } from '../../shared/constants';
import { downloadToFile } from '../net/download';
import { readJsonCapped } from '../net/json';
import { writeJsonAtomic } from '../util/atomic-file';
import { syncContentFromManifest } from './content-manager';
import { sha256File, fileMatches, verifyDownload, type HashedEntry } from './integrity';
import { configVersion, shouldApplyConfigOverride } from './config-overrides';
import { pendingChanges } from './pack-diff';
import { getMainWindow } from '../../main/window';
import { verifyManifestSignature, assertManifestTrusted } from '../updater/manifest-verify';
import { isFirstPartyManifestUrl } from '../../shared/branding';
import { assertSecureContentUrl } from '../../shared/validators';
import { resolveWithin } from '../util/safe-path';
import type { SignedManifest } from '../updater/canonical';
import {
  fileNameFromUrl,
  isSafeFileName,
  modManifestSchema,
  type ModEntry,
  type ModManifest,
} from '../../shared/manifest-schema';
import type {
  InstalledMod,
  ManifestVerification,
  ModInstallResult,
  ProfileSyncStatus,
  ModSearchResult,
  ProgressEvent,
  ProgressMessage,
  TrustedKey,
} from '../../shared/ipc-types';

function emitProgress(channel: 'progress:mod-sync', event: ProgressEvent): void {
  getMainWindow()?.webContents.send(channel, event);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// ── Sync state (ETag + last result), persisted per profile ─

interface SyncState {
  lastSyncedAt?: string;
  manifestEtag?: string;
  pendingUpdates: number;
  status: ProfileSyncStatus['status'];
  errorMessage?: string;
  /**
   * What the signature check said about the manifest that was last installed.
   *
   * Recorded rather than recomputed on demand, because the only honest answer
   * to "is this profile's manifest signed?" is one about the bytes that were
   * actually reconciled. Asking the server again would report on a different
   * response.
   */
  verification?: ManifestVerification;
  /**
   * Which version of each config override this profile has already been given,
   * keyed by the path inside the game directory.
   *
   * It is what separates "the author changed this file" from "the player did" —
   * see `shouldApplyConfigOverride`. Rebuilt from the manifest on every sync, so
   * a path the pack stopped shipping drops out with it.
   */
  appliedConfigs?: Record<string, string>;
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
  await writeJsonAtomic(paths.profileSyncStateFile(profileId), state);

  const status: ProfileSyncStatus = { profileId, ...state };
  getMainWindow()?.webContents.send('profiles:sync-status-changed', status);
}

// ── Manifest cache ─────────────────────────────────────────
// The ETag alone is not enough state to work with. A 304 means "you already
// have this" — but without the body there is nothing to reconcile the profile
// against, so the sync used to return early and report success while a jar the
// player deleted by hand stayed missing. Caching the last body that validated
// fixes that, and is also what makes a sync possible with no network at all.
//
// What is cached is the *raw* document, not the schema's output. Zod drops keys
// it does not know about, so caching its result would canonicalize to different
// bytes than the ones the publisher signed and every cached manifest would fail
// verification on the offline path.

/** A manifest as fetched, alongside the validated view of it. */
interface LoadedManifest {
  /** Raw parsed JSON — the form the signature covers. */
  raw: unknown;
  manifest: ModManifest;
}

async function readCachedManifest(profileId: string): Promise<LoadedManifest | null> {
  try {
    const text = await fs.readFile(paths.profileManifestCacheFile(profileId), 'utf-8');
    const raw: unknown = JSON.parse(text);
    const parsed = modManifestSchema.safeParse(raw);
    return parsed.success ? { raw, manifest: parsed.data } : null;
  } catch {
    return null;
  }
}

async function writeCachedManifest(profileId: string, raw: unknown): Promise<void> {
  await writeJsonAtomic(paths.profileManifestCacheFile(profileId), raw);
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

/**
 * What the signature check said about the manifest this profile is running.
 *
 * Reports the recorded outcome of the last sync rather than asking the server
 * again. Re-fetching would answer a different question — "would a manifest
 * downloaded right now verify?" — and present the answer as though it were
 * about the jars already sitting in `mods/`.
 */
export async function getLastManifestVerification(
  profileId: string,
): Promise<ManifestVerification> {
  const profile = await getProfile(profileId);
  if (!profile) return { signed: false, valid: false, error: 'Profile not found' };
  if (!profile.manifestUrl) {
    return { signed: false, valid: false, error: 'Profile has no manifest URL' };
  }

  const { verification } = await readSyncState(profileId);
  return verification ?? { signed: false, valid: false, neverSynced: true };
}

/**
 * Ask whether the pack moved, and record the answer — installing nothing.
 *
 * Without this the badge only ever changed when a sync ended, so a profile read
 * "Synced" from the moment it last reconciled until the next time the player
 * happened to press Sync, however many pack releases went by in between. The
 * check costs one conditional GET: unchanged manifests come back 304 and are
 * reconciled against the cached copy.
 *
 * The fetched ETag is deliberately **not** stored. The recorded one means "the
 * manifest this profile was last reconciled against", and a check reconciles
 * nothing — keeping it is what makes the next real sync still see the update.
 */
export async function checkForPackUpdates(profileId: string): Promise<void> {
  const profile = await getProfile(profileId);
  if (!profile?.manifestUrl) return;

  const previous = await readSyncState(profileId);
  // Nothing installed yet is not something to be behind on, and the badge
  // already says so.
  if (previous.status === 'never-synced') return;

  try {
    const settings = await getSettings();
    const { manifest } = await obtainManifest(
      profileId,
      profile.name,
      profile.manifestUrl,
      previous.manifestEtag,
      settings.trustedPublicKeys,
      new AbortController().signal,
    );

    const pending = pendingChanges(manifest.mods, await readLockFile(profileId));

    // A sync that ran while this check was in flight knows better than it does.
    const current = await readSyncState(profileId);
    if (current.lastSyncedAt !== previous.lastSyncedAt) return;

    await writeSyncState(profileId, {
      ...current,
      pendingUpdates: pending,
      status: pending > 0 ? 'updates-available' : 'synced',
    });
    log.info(
      pending > 0
        ? `${profile.name}: the pack moved — ${pending} mod(s) differ from the manifest`
        : `${profile.name}: up to date with the pack`,
    );
  } catch (err) {
    // A check the player never asked for must not turn a working profile red.
    // Pressing Sync reports a real failure properly; this one only ever had
    // permission to deliver good news or none.
    log.warn(`Update check failed for ${profile.name}: ${err}`);
  }
}

/** Every profile that follows a pack, checked once at startup. */
export async function checkAllProfilesForPackUpdates(): Promise<void> {
  for (const profile of await getAllProfiles()) {
    if (profile.manifestUrl) await checkForPackUpdates(profile.id);
  }
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
    // The schema has already rejected a `fileName` that is anything but a bare
    // filename, so this cannot leave the mods directory.
    const fileName = entry.fileName ?? fileNameFromUrl(entry.url, entry.id, '.jar');
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
      const fileName = path.basename(entry.localPath);
      // `basename` of a path ending in `..` is `..`, which would resolve to the
      // parent of the mods directory rather than to a file inside it.
      if (!isSafeFileName(fileName)) {
        throw new Error(`${entry.name}: localPath does not name a file`);
      }
      return { localPath: entry.localPath, fileName, version: entry.version };
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
    await downloadToFile(resolved.url!, destPath, { signal });
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
 *
 * Every one of the three is signature-checked, on the raw document about to be
 * used, before this returns. That is the whole point of doing it here rather
 * than beside the UI badge: there is no window between the bytes being approved
 * and the bytes being installed, because they are the same bytes.
 */
async function obtainManifest(
  profileId: string,
  profileName: string,
  manifestUrl: string,
  knownEtag: string | undefined,
  trustedKeys: TrustedKey[],
  signal: AbortSignal,
): Promise<{
  manifest: ModManifest;
  etag: string | undefined;
  verification: ManifestVerification;
}> {
  const headers: Record<string, string> = {};
  if (knownEtag) headers['If-None-Match'] = knownEtag;

  // A manifest served over plaintext http can be rewritten in transit — the
  // signature stripped, the mod URLs repointed — so it is refused before the
  // first byte, whether this is a fresh fetch or a cache revalidation.
  assertSecureContentUrl(manifestUrl);
  const firstParty = isFirstPartyManifestUrl(manifestUrl);

  /** Apply the trust policy, then hand back what the caller may install. */
  const approve = (loaded: LoadedManifest, etag: string | undefined) => {
    const verification = verifyManifestSignature(loaded.raw as SignedManifest, trustedKeys);
    assertManifestTrusted(verification, trustedKeys, profileName, firstParty);
    return { manifest: loaded.manifest, etag, verification };
  };

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
    return approve(cached, knownEtag);
  }

  if (res.status === 304) {
    // A 304 body is empty by definition, so the cached copy is the only thing
    // there is to reconcile against. Without one, drop the conditional header
    // and ask again rather than reporting a sync that checked nothing.
    const cached = await readCachedManifest(profileId);
    if (cached) {
      log.info(`Manifest unchanged (304) for ${profileName} — reconciling local files`);
      return approve(cached, knownEtag);
    }
    log.info(`Manifest unchanged (304) for ${profileName} but nothing cached — refetching`);
    res = await fetch(manifestUrl, { signal: withTimeout(signal, 15000) });
  }

  if (!res.ok) throw new Error(`Failed to fetch manifest: ${res.status} ${res.statusText}`);

  const raw = await readJsonCapped(res, 'The manifest');
  const loaded: LoadedManifest = { raw, manifest: parseManifest(raw, profileName) };

  // Approved before it is cached: a manifest the policy rejects must not become
  // the copy a later offline sync falls back to.
  const approved = approve(loaded, res.headers.get('etag') ?? knownEtag);
  await writeCachedManifest(profileId, raw);
  return approved;
}

/**
 * Bring a profile's files in line with a manifest.
 *
 * `supplied` is for a manifest that came from somewhere other than a URL — an
 * imported `.mrpack` is a list of files with URLs and hashes, which is what a
 * manifest is, so it is converted and handed straight in. That reuses this
 * whole path rather than growing a second one: progress reporting,
 * cancellation, hash verification, orphan removal, the resource-pack order
 * written into `options.txt`, and a lock file the mods page can read. A supplied
 * manifest is cached like a fetched one, so syncing an imported pack again later
 * repairs anything deleted by hand.
 */
export async function syncManifest(profileId: string, supplied?: ModManifest): Promise<void> {
  const profile = await getProfile(profileId);
  if (!profile) throw new Error(`Profile ${profileId} not found`);
  if (!profile.manifestUrl && !supplied) {
    throw new Error('Profile has no manifest URL configured');
  }

  log.info(`Syncing manifest for profile ${profile.name}: ${profile.manifestUrl ?? 'imported'}`);

  // A modpack sync is a long download; let the user call it off.
  const signal = beginJob(profileId);
  const previousState = await readSyncState(profileId);

  try {
    const settings = await getSettings();

    let manifest: ModManifest;
    let etag: string | undefined;
    // A supplied manifest was built here from a file the user chose, so there is
    // no publisher to have signed it and nothing for the badge to claim.
    let verification: ManifestVerification | undefined;
    if (supplied) {
      manifest = supplied;
      await writeCachedManifest(profileId, supplied);
    } else {
      ({ manifest, etag, verification } = await obtainManifest(
        profileId,
        profile.name,
        profile.manifestUrl!,
        previousState.manifestEtag,
        settings.trustedPublicKeys,
        signal,
      ));
    }

    if (manifest.minecraftVersion !== profile.minecraftVersion) {
      log.warn(
        `Manifest targets MC ${manifest.minecraftVersion} but profile ${profile.name} is pinned to ${profile.minecraftVersion}`,
      );
    }

    const modsDir = paths.profileModsDir(profileId);
    await fs.mkdir(modsDir, { recursive: true });

    // Client-side sync: server-only mods are not installed into a player instance.
    const entries = manifest.mods.filter((m) => m.side === 'client' || m.side === 'both');
    const existing = await readLockFile(profileId);
    const synced: InstalledMod[] = [];

    // Checking comes first and downloading second, as two passes with two
    // counters, because the single pass they replace could not tell the two
    // apart on screen. Every profile that follows a pack is synced before it
    // launches, and the overwhelmingly common outcome is that nothing has
    // moved — but the progress line still walked the mod list one name at a
    // time under a file counter, which is indistinguishable from installing
    // them. The first person to try the launcher reported the pack being
    // downloaded twice; it never was. Now the counter that runs during the
    // check says it is checking, and the download counter only exists, and
    // only counts, when there is something to fetch.
    const checkTotal = entries.length + manifest.configFiles.length;
    let checked = 0;

    // Neither pass may report 1: the renderer clears an operation that says it
    // has finished, and the download pass may still be to come. Both counters
    // are emitted before the item they announce, so the last value of each is
    // one short — the single completion event at the end of the sync is the
    // only thing that reports the whole job done.
    const reportCheck = () =>
      emitProgress('progress:mod-sync', {
        operationId: profileId,
        progress: checkTotal > 0 ? checked / checkTotal : 0,
        message: { key: 'progress.msg.checkingFiles' },
        filesCompleted: checked,
        filesTotal: checkTotal,
      });

    emitProgress('progress:mod-sync', {
      operationId: profileId,
      progress: 0,
      message: { key: 'progress.msg.syncing', vars: { name: profile.name } },
    });

    /** One manifest mod, resolved against what is already on disk. */
    interface PlannedMod {
      entry: ModEntry;
      resolved: Awaited<ReturnType<typeof resolveModEntry>>;
      /** Where the file belongs, suffix included when the mod is switched off. */
      destPath: string;
      previous?: InstalledMod;
      enabled: boolean;
      /** Set when the file is already there and matches — nothing to fetch. */
      hash?: string;
    }

    const plannedMods: PlannedMod[] = [];
    for (const entry of entries) {
      throwIfCancelled(signal, 'Sync');
      reportCheck();

      const previous = existing.find((m) => m.id === entry.id);
      const resolved = await resolveModEntry(entry, manifest);
      // A mod the player switched off stays off, whether or not this sync has
      // to fetch a new build of it. Both the file looked for and the file
      // written therefore carry the suffix its state implies.
      const enabled = previous?.enabled ?? true;
      const destPath = modFilePath(modsDir, resolved.fileName, enabled);

      // Already on disk and matching the manifest hash — leave it alone.
      let hash: string | undefined;
      if (previous && (await fileMatches(destPath, entry))) {
        hash = previous.sha256 ?? (await sha256File(destPath));
      }

      plannedMods.push({ entry, resolved, destPath, previous, enabled, hash });
      checked++;
    }

    /** One config override, and whether this sync has to write it. */
    interface PlannedConfig {
      config: ModManifest['configFiles'][number];
      gameDir: string;
      dest: string;
      write: boolean;
    }

    const plannedConfigs: PlannedConfig[] = [];
    for (const config of manifest.configFiles) {
      throwIfCancelled(signal, 'Sync');
      reportCheck();

      const gameDir = paths.profileGameDir(profileId);
      const dest = path.join(gameDir, config.path);
      const relative = path.relative(gameDir, dest);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`Manifest config path escapes the game directory: ${config.path}`);
      }

      const exists = await fileExists(dest);
      const write = shouldApplyConfigOverride(
        config,
        previousState.appliedConfigs?.[config.path],
        exists,
      );
      plannedConfigs.push({ config, gameDir, dest, write });
      checked++;
    }

    const downloadTotal =
      plannedMods.filter((p) => !p.hash).length + plannedConfigs.filter((c) => c.write).length;
    let fetched = 0;

    const reportDownload = (message: ProgressMessage, currentFile?: string) =>
      emitProgress('progress:mod-sync', {
        operationId: profileId,
        progress: downloadTotal > 0 ? fetched / downloadTotal : 0,
        message,
        currentFile,
        filesCompleted: fetched,
        filesTotal: downloadTotal,
      });

    for (const planned of plannedMods) {
      const { entry, resolved, destPath, previous, enabled } = planned;

      if (!planned.hash) {
        throwIfCancelled(signal, 'Sync');
        reportDownload({ key: 'progress.msg.downloadingFile', vars: { name: entry.name } });

        log.info(`Downloading mod: ${entry.name} (${resolved.fileName})`);
        planned.hash = await fetchModEntry(entry, resolved, destPath, signal);

        // A version bump changes the filename; drop the file it replaced, at
        // whichever of the two names that file was under.
        if (previous && previous.fileName !== resolved.fileName) {
          try {
            await fs.rm(modFilePath(modsDir, previous.fileName, enabled), { force: true });
          } catch {
            /* ok */
          }
        }
        fetched++;
      }

      synced.push({
        id: entry.id,
        name: entry.name,
        version: resolved.version,
        source: entry.source,
        fileName: resolved.fileName,
        sha256: planned.hash,
        required: entry.required,
        side: entry.side,
        enabled,
        fromManifest: true,
      });
    }

    // Config overrides, resolved relative to the profile's .minecraft directory.
    const appliedConfigs: Record<string, string> = {};
    let configsWritten = 0;

    for (const { config, gameDir, dest, write } of plannedConfigs) {
      if (write) {
        throwIfCancelled(signal, 'Sync');
        reportDownload({ text: config.path }, config.path);

        // Refuse a symlink already sitting in the game dir that would redirect
        // this write out of the tree: the parent is proven contained through
        // realpath here, and `noFollow` refuses a link at the file itself.
        await resolveWithin(gameDir, config.path);
        await downloadToFile(config.url, dest, { signal, noFollow: true });
        await verifyDownload(dest, config, `config ${config.path}`);
        log.info(`Applied config override: ${config.path}`);
        configsWritten++;
        fetched++;
      }

      const version = configVersion(config);
      if (version) appliedConfigs[config.path] = version;
    }

    const mcVersion = manifest.minecraftVersion;
    await syncContentFromManifest('resourcepacks', profileId, manifest.resourcePacks, mcVersion);
    await syncContentFromManifest('shaders', profileId, manifest.shaders, mcVersion);

    // Mods that were installed from a previous manifest but are gone from this one.
    const keptIds = new Set(synced.map((m) => m.id));

    // Read again here, under the lock, rather than reusing the snapshot taken
    // before the downloads: minutes have passed, and a mod the player installed
    // by hand in the meantime would otherwise be written out of existence by a
    // list assembled before it arrived. Only the manifest's own half of the file
    // is this function's to replace.
    const orphaned = await mutateLockFile(profileId, (mods) => {
      const userInstalled = mods.filter((m) => !m.fromManifest);
      const stale = mods.filter((m) => m.fromManifest && !keptIds.has(m.id));
      const next = settings.autoRemoveOrphanedMods
        ? [...synced, ...userInstalled]
        : // Keep them installed and surface the count so the UI can prompt.
          [...synced, ...stale, ...userInstalled];
      mods.splice(0, mods.length, ...next);
      return stale;
    });

    // After the write, not before it: the lock file is what the next sync reads
    // to decide what exists, so it is the thing that must be correct if the
    // process dies between the two.
    if (settings.autoRemoveOrphanedMods) {
      for (const stale of orphaned) {
        try {
          await fs.rm(modFilePath(modsDir, stale.fileName, stale.enabled), { force: true });
        } catch {
          /* ok */
        }
        log.info(`Removed orphaned mod ${stale.name} from profile ${profile.name}`);
      }
    }

    const pendingUpdates = settings.autoRemoveOrphanedMods ? 0 : orphaned.length;

    await writeSyncState(profileId, {
      lastSyncedAt: new Date().toISOString(),
      manifestEtag: etag ?? undefined,
      pendingUpdates,
      status: pendingUpdates > 0 ? 'updates-available' : 'synced',
      verification,
      appliedConfigs,
    });

    emitProgress('progress:mod-sync', {
      operationId: profileId,
      progress: 1,
      message: { pluralKey: 'progress.msg.synced', count: synced.length },
      filesCompleted: checkTotal,
      filesTotal: checkTotal,
    });
    log.info(
      `Manifest sync complete for ${profile.name}: ${synced.length} mods, ` +
        `${configsWritten} of ${manifest.configFiles.length} configs written, ` +
        `${orphaned.length} orphaned`,
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
export function downloadFor(version: ModrinthVersion): {
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

/**
 * Download, verify and record one already-resolved file.
 *
 * `replaces` names a lock entry to stand in for, where that is not simply the
 * one with the same id. An update found by hashing the jar is exactly that
 * case: a mod dropped into `mods/` by hand is recorded under a generated
 * `local-…` id, and the build replacing it is a Modrinth project with a project
 * id of its own. Without this the entry would be appended beside the old one,
 * leaving the profile with two records and two jars of the same mod.
 */
export async function installResolvedMod(
  profileId: string,
  identity: { id: string; name: string; source: InstalledMod['source'] },
  resolved: { url: string; fileName: string; version: string; hashes: HashedEntry },
  replaces?: string,
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

  await mutateLockFile(profileId, async (mods) => {
    const previous = replaces ?? identity.id;
    const idx = mods.findIndex((m) => m.id === previous);
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
  });

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

export async function uninstallMod(profileId: string, modId: string): Promise<void> {
  const modsDir = paths.profileModsDir(profileId);
  const name = await mutateLockFile(profileId, async (mods) => {
    const idx = mods.findIndex((m) => m.id === modId);
    if (idx < 0) throw new Error(`Mod ${modId} not found in profile ${profileId}`);
    const mod = mods[idx];

    // Delete file
    try {
      await fs.rm(modFilePath(modsDir, mod.fileName, mod.enabled), { force: true });
    } catch {
      /* ok */
    }

    mods.splice(idx, 1);
    return mod.name;
  });
  log.info(`Uninstalled mod ${name} from profile ${profileId}`);
}

export async function toggleModEnabled(
  profileId: string,
  modId: string,
  enabled: boolean,
): Promise<void> {
  const modsDir = paths.profileModsDir(profileId);
  const name = await mutateLockFile(profileId, async (mods) => {
    const mod = mods.find((m) => m.id === modId);
    if (!mod) throw new Error(`Mod ${modId} not found`);
    if (mod.enabled === enabled) return null;

    await fs.rename(
      modFilePath(modsDir, mod.fileName, mod.enabled),
      modFilePath(modsDir, mod.fileName, enabled),
    );
    mod.enabled = enabled;
    return mod.name;
  });
  if (name === null) return;
  log.info(`${enabled ? 'Enabled' : 'Disabled'} mod ${name} in profile ${profileId}`);
}
