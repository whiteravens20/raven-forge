// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

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
import { getAllProfiles, getProfile, updateProfile } from '../profiles/profile-manager';
import { getModVersions, getVersion, primaryFile, type ModrinthVersion } from './modrinth-api';
import { readLockFile, mutateLockFile, modFilePath, isSameModFile } from './lock-file';
import { resolveDependencies } from './compatibility';
import { acceptedLoaders } from '../../shared/constants';
import { downloadToFile } from '../net/download';
import { assertSecureAnswer, readJsonCapped } from '../net/json';
import { writeJsonAtomic } from '../util/atomic-file';
import { forEachConcurrently } from '../util/concurrency';
import { emitProgress, withProgress } from '../util/progress';
import { syncContentFromManifest } from './content-manager';
import {
  fileMatches,
  verifyDownload,
  expectedHash,
  pinnedHashes,
  type HashedEntry,
} from './integrity';
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
  ProgressMessage,
  TrustedKey,
} from '../../shared/ipc-types';
import { errorText } from '../util/error-text';

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

  // Read back through the door the renderer knocks on, rather than built from
  // `state` here: the status says more than the file does, and an event that
  // left `importedPack` out would take the repair button off the screen.
  getMainWindow()?.webContents.send(
    'profiles:sync-status-changed',
    await getProfileSyncStatus(profileId),
  );
}

// ── Manifest cache ─────────────────────────────────────────
// The ETag alone is not enough state to work with. A 304 means "you already
// have this" — but without the body there is nothing to reconcile the profile
// against, so the sync used to return early and report success while a jar the
// player deleted by hand stayed missing. Keeping the body fixes that, and is
// also what makes a sync possible with no network at all.
//
// The copy and the recorded ETag are one statement — "the manifest this profile
// was last brought in line with, and what the server called it" — so they are
// written together, by a sync that finished, and by nothing else. The copy used
// to be written as soon as a manifest arrived: by the update check, which
// installs nothing, and by a sync that then failed. Either left a newer release
// here under the older one's tag. A server answering 304 to that tag — the
// publisher having taken the release back — was then answered with the release
// that had been withdrawn, and with no network a profile that had only seen a
// new release was synced against files it could not fetch.
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

/**
 * The part of the stored state the profile page shows.
 *
 * Picked out by name. The whole record used to be spread into the answer, which
 * sent the page the ETag, the signature finding and the list of config files
 * this profile has been given — none of it asked for, and none of it declared.
 */
async function shownSyncState(
  profileId: string,
): Promise<Pick<ProfileSyncStatus, 'pendingUpdates' | 'status' | 'errorMessage'>> {
  const { pendingUpdates, status, errorMessage } = await readSyncState(profileId);
  return { pendingUpdates, status, errorMessage };
}

export async function getProfileSyncStatus(profileId: string): Promise<ProfileSyncStatus> {
  const profile = await getProfile(profileId);
  if (!profile) {
    return { profileId, pendingUpdates: 0, status: 'error', errorMessage: 'Profile not found' };
  }
  if (!profile.manifestUrl) {
    // A profile made from a pack file follows no address — but the pack it was
    // installed from is kept, and that is something a sync can be run against.
    if (!(await readCachedManifest(profileId))) {
      return { profileId, pendingUpdates: 0, status: 'never-synced' };
    }
    return { profileId, ...(await shownSyncState(profileId)), importedPack: true };
  }

  return { profileId, ...(await shownSyncState(profileId)) };
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
    log.warn(`Update check failed for ${profile.name}: ${errorText(err)}`);
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
 * matched against Modrinth's `version_number` and its opaque version `id`, so
 * manifests can pin either.
 *
 * A label that names neither is refused. It used to fall back to the newest
 * build, which is how a profile came to run a different version of a mod from
 * the server its pack was written for, with nothing said — and since no sync
 * would ever install the version the manifest did name, the profile was counted
 * as behind the pack by that entry for good.
 */
export async function resolveModEntry(
  entry: ModEntry,
  manifest: ModManifest,
): Promise<ResolvedDownload> {
  // Fast path: a manifest that already carries the direct download URL needs no
  // API lookup at all. Pack generators emit this, so syncing a 100-mod pack
  // costs zero Modrinth requests and stays resolvable even if the API is down.
  if (entry.url && entry.source !== 'local') {
    // The schema has already rejected a `fileName` that is anything but a bare
    // filename, so this cannot leave the mods directory.
    const fileName = entry.fileName ?? fileNameFromUrl(entry.url, entry.id, '.jar');
    // A mod fetched straight from a manifest URL has no API lookup to supply a
    // hash, so the entry's own is the only thing pinning the jar this process is
    // about to load as code. Required, not optional: without it a plaintext hop
    // or an unsigned manifest could swap the file and nothing would notice.
    if (!expectedHash(entry)) {
      throw new Error(
        `${entry.name}: a mod given by url must declare a sha512, sha256 or sha1 hash`,
      );
    }
    return { url: entry.url, fileName };
  }

  switch (entry.source) {
    case 'modrinth': {
      if (!entry.projectId) {
        throw new Error(`${entry.name}: source "modrinth" requires projectId or url`);
      }
      const loaders = acceptedLoaders(manifest.modLoader);
      const versions = await getModVersions(entry.projectId, manifest.minecraftVersion, loaders);
      const match = versions.find(
        (v) => v.version_number === entry.version || v.id === entry.version,
      );
      if (!match) {
        throw new Error(
          `${entry.name}: no Modrinth version "${entry.version}" for ` +
            `MC ${manifest.minecraftVersion} / ${manifest.modLoader}`,
        );
      }
      const file = primaryFile(match);
      return {
        url: file.url,
        fileName: file.filename,
        // Verify against the hash Modrinth publishes for this exact build, even
        // when the manifest carried none of its own — the API always returns
        // sha512/sha1, so a modrinth entry is never installed unverified.
        hashes: { sha512: file.hashes.sha512, sha1: file.hashes.sha1 },
      };
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
      return { localPath: entry.localPath, fileName };
    }
  }
}

/**
 * Download (or copy) one entry into the profile, once its hash has been checked.
 *
 * Either way the file takes its place only when it is whole and correct, so an
 * entry that fails leaves the build already in `mods/` where it was.
 */
async function fetchModEntry(
  entry: ModEntry,
  resolved: ResolvedDownload,
  destPath: string,
  signal?: AbortSignal,
): Promise<void> {
  const hashes = pinnedHashes(entry, resolved.hashes);

  if (resolved.localPath) {
    const part = `${destPath}.part`;
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    try {
      await fs.copyFile(resolved.localPath, part);
      await verifyDownload(part, hashes, entry.name);
      await fs.rename(part, destPath);
    } catch (err) {
      await fs.rm(part, { force: true });
      throw err;
    }
  } else {
    await downloadToFile(resolved.url!, destPath, {
      signal,
      secure: true,
      verify: { hashes, label: entry.name },
    });
  }
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
 *
 * Nothing is kept here. A document that came from the server is handed back as
 * `fetched`, and it is the sync that keeps it, once it has installed it.
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
  /** The raw document, when it came from the server and not from the copy. */
  fetched?: unknown;
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
    const verification = verifyManifestSignature(
      loaded.raw as SignedManifest,
      trustedKeys,
      firstParty,
    );
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
  assertSecureAnswer(res);

  const raw = await readJsonCapped(res, 'The manifest');
  const loaded: LoadedManifest = { raw, manifest: parseManifest(raw, profileName) };

  // Approved before it is handed back to be kept: a manifest the policy rejects
  // must not become the copy a later offline sync falls back to.
  return { ...approve(loaded, res.headers.get('etag') ?? knownEtag), fetched: raw };
}

/**
 * Bring a profile's files in line with a manifest.
 *
 * `supplied` is for a manifest that came from somewhere other than a URL — an
 * imported `.mrpack` is a list of files with URLs and hashes, which is what a
 * manifest is, so it is converted and handed straight in. That reuses this
 * whole path rather than growing a second one: progress reporting,
 * cancellation, hash verification, removal of what a pack dropped, the
 * resource-pack order
 * written into `options.txt`, and a lock file the mods page can read. A supplied
 * manifest is cached like a fetched one, and with no address to ask it is the
 * cached copy a later sync reconciles against — so syncing an imported pack
 * again finishes an install that stopped half-way and repairs anything deleted
 * by hand.
 */
export function syncManifest(profileId: string, supplied?: ModManifest): Promise<void> {
  return withProgress(() => runSync(profileId, supplied));
}

async function runSync(profileId: string, supplied?: ModManifest): Promise<void> {
  const profile = await getProfile(profileId);
  if (!profile) throw new Error(`Profile ${profileId} not found`);

  // The pack itself, for a profile that was made from one: handed in by the
  // import, or read back from where the import left it. This used to stop at
  // the check below instead, with the pack sitting in the cache unread, so the
  // one sync an imported profile ever got was the one that created it.
  const pack =
    supplied ?? (profile.manifestUrl ? undefined : (await readCachedManifest(profileId))?.manifest);
  if (!profile.manifestUrl && !pack) {
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
    // What the server sent, kept at the end and only if this sync gets there.
    let fromServer: unknown;
    if (pack) {
      // Kept at once, unlike a fetched one: with no address to ask, this copy
      // is the only thing a later sync has to finish the install from.
      manifest = pack;
      await writeCachedManifest(profileId, pack);
    } else {
      ({
        manifest,
        etag,
        verification,
        fetched: fromServer,
      } = await obtainManifest(
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

    // A profile that follows a pack follows its loader build too. The build was
    // copied once, when the profile was made, and never again: a pack that then
    // moved to a newer one — because a mod in it needs that — delivered the mod
    // and left the profile starting the loader it no longer runs on.
    //
    // The build only. A different loader, or a different Minecraft version, is
    // a different game directory in all but name — worlds are upgraded in place
    // and do not go back — so those are said in the log and left for a person.
    if (
      !pack &&
      manifest.modLoader === profile.modLoader &&
      manifest.modLoaderVersion &&
      manifest.modLoaderVersion !== profile.modLoaderVersion
    ) {
      log.info(
        `${profile.name}: the pack moved ${manifest.modLoader} from ` +
          `${profile.modLoaderVersion ?? 'no build'} to ${manifest.modLoaderVersion}`,
      );
      await updateProfile(profileId, { modLoaderVersion: manifest.modLoaderVersion });
    } else if (!pack && manifest.modLoader !== profile.modLoader) {
      log.warn(
        `Manifest targets ${manifest.modLoader} but profile ${profile.name} runs ${profile.modLoader}`,
      );
    }

    const modsDir = paths.profileModsDir(profileId);
    await fs.mkdir(modsDir, { recursive: true });

    // Client-side sync: server-only mods are not installed into a player instance.
    const entries = manifest.mods.filter((m) => m.side === 'client' || m.side === 'both');
    const existing = await readLockFile(profileId);

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
    // are emitted before the item they announce, so the last value of each
    // falls short of the whole — the single completion event at the end of the
    // sync is the only thing that reports the whole job done.
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
      /** The file is already there and matches — nothing to fetch. */
      present: boolean;
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

      // Already on disk and matching — leave it alone. Whether the lock file
      // has heard of it is beside the point: the lock is written once, at the
      // very end, so a first install that failed at mod sixty had recorded
      // nothing, and the retry fetched the first fifty-nine again — on every
      // launch, for as long as that one URL stayed broken.
      const present = await fileMatches(destPath, pinnedHashes(entry, resolved.hashes));

      plannedMods.push({ entry, resolved, destPath, previous, enabled, present });
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
      plannedMods.filter((p) => !p.present).length + plannedConfigs.filter((c) => c.write).length;
    let fetched = 0;

    const reportDownload = (message: ProgressMessage, currentFile?: string) =>
      emitProgress('progress:mod-sync', {
        operationId: profileId,
        progress: downloadTotal > 0 ? fetched / downloadTotal : 0,
        message,
        currentFile,
        filesCompleted: fetched,
        filesTotal: downloadTotal,
        installing: true,
      });

    // A version bump changes the filename; this drops the file it replaced, at
    // whichever of the two names that file is under while the mod is `enabled`.
    const dropReplaced = async ({ previous, resolved }: PlannedMod, enabled: boolean) => {
      if (previous && !isSameModFile(previous.fileName, resolved.fileName)) {
        await fs.rm(modFilePath(modsDir, previous.fileName, enabled), { force: true });
      }
    };

    // As many at a time as the downloads setting says. That setting was only
    // ever read for the game's own libraries and assets, so a pack of two
    // hundred mods came down one file after another whatever it was set to.
    await forEachConcurrently(
      plannedMods.filter((p) => !p.present),
      settings.downloadConcurrency,
      async (planned) => {
        const { entry, resolved, destPath } = planned;
        throwIfCancelled(signal, 'Sync');
        reportDownload({ key: 'progress.msg.downloadingFile', vars: { name: entry.name } });

        log.info(`Downloading mod: ${entry.name} (${resolved.fileName})`);
        await fetchModEntry(entry, resolved, destPath, signal);
        await dropReplaced(planned, planned.enabled);
        fetched++;
      },
    );

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
        await downloadToFile(config.url, dest, {
          signal,
          noFollow: true,
          secure: true,
          verify: { hashes: config, label: `config ${config.path}` },
        });
        log.info(`Applied config override: ${config.path}`);
        configsWritten++;
        fetched++;
      }

      const version = configVersion(config);
      if (version) appliedConfigs[config.path] = version;
    }

    // The resource packs and shaders below take no signal of their own, so this
    // is the last point at which a cancel is still honoured.
    throwIfCancelled(signal, 'Sync');
    const mcVersion = manifest.minecraftVersion;
    await syncContentFromManifest('resourcepacks', profileId, manifest.resourcePacks, mcVersion);
    await syncContentFromManifest('shaders', profileId, manifest.shaders, mcVersion);

    // Mods the pack put here and no longer ships. They go, always: a profile
    // that follows a pack is meant to match it, and a mod the server dropped is
    // as likely to stop the client joining as one it added and the client lacks.
    //
    // This was a setting, off by default, and off was not a state anyone could
    // live in. The mods stayed, the profile was marked "updates available" for
    // as many as there were, pressing Sync changed nothing because the same
    // sync left them there again — and they could not be removed by hand
    // either, since a pack's mods have no Remove button.
    const keptIds = new Set(plannedMods.map((p) => p.entry.id));

    // Read again here, under the lock, rather than reusing the snapshot taken
    // before the downloads: minutes have passed, and a mod the player installed
    // by hand in the meantime would otherwise be written out of existence by a
    // list assembled before it arrived. Only the manifest's own half of the file
    // is this function's to replace — what the player added is theirs to keep.
    //
    // The files go before the list is rewritten, inside the same turn. Done the
    // other way round, a jar that could not be deleted — Windows refuses while
    // the game has it open — was left in `mods/` with nothing recording it:
    // still loaded by the game, never looked at by a sync again. This way a
    // failure leaves the list as it was, the sync says why it stopped, and the
    // next one tries again.
    const { synced, dropped } = await mutateLockFile(profileId, async (mods) => {
      // In the manifest's order, whatever order the files arrived in.
      const synced: InstalledMod[] = [];
      for (const planned of plannedMods) {
        const { entry, resolved } = planned;

        // Whether the mod is switched on is asked again here too. The plan
        // answered it before the downloads, and a player who switched a mod
        // off while they ran had its file renamed and that recorded — after
        // which the plan's answer was written back over theirs. The mod came
        // out of the sync marked on with its file under the other name, so the
        // next sync called it missing and fetched it again beside that file.
        const enabled = mods.find((m) => m.id === entry.id)?.enabled ?? planned.enabled;
        if (enabled !== planned.enabled) {
          // What this sync fetched is under the name the plan gave it, and what
          // it replaced was moved by the switch before the cleanup looked.
          const fetchedAs = modFilePath(modsDir, resolved.fileName, planned.enabled);
          if (await fileExists(fetchedAs)) {
            await fs.rename(fetchedAs, modFilePath(modsDir, resolved.fileName, enabled));
          }
          await dropReplaced(planned, enabled);
        }

        synced.push({
          id: entry.id,
          projectId: entry.projectId,
          name: entry.name,
          // The manifest's own label, whichever of a build's two names it is.
          // It is what the update check compares, so recording Modrinth's
          // version number for an entry pinned by id left that entry reading
          // as out of date the moment the sync that installed it had finished.
          version: entry.version,
          source: entry.source,
          fileName: resolved.fileName,
          enabled,
          fromManifest: true,
        });
      }

      const userInstalled = mods.filter((m) => !m.fromManifest);
      const stale = mods.filter((m) => m.fromManifest && !keptIds.has(m.id));
      for (const mod of stale) {
        // Unless something the pack still ships is now living in that file. A
        // pack that renames an entry and keeps its jar drops the old id and
        // adds a new one with the same file name; deleting "the old mod's
        // file" would delete the new mod's.
        const inUse = [...synced, ...userInstalled].some((kept) =>
          isSameModFile(kept.fileName, mod.fileName),
        );
        if (!inUse) {
          await fs.rm(modFilePath(modsDir, mod.fileName, mod.enabled), { force: true });
        }
        log.info(`Removed ${mod.name} from ${profile.name}: the pack no longer ships it`);
      }
      mods.splice(0, mods.length, ...synced, ...userInstalled);
      return { synced, dropped: stale };
    });

    // The copy first and its tag after it. Cut short between the two, the
    // profile is left asking with the older tag, and is sent the manifest again.
    if (fromServer !== undefined) await writeCachedManifest(profileId, fromServer);
    await writeSyncState(profileId, {
      lastSyncedAt: new Date().toISOString(),
      manifestEtag: etag ?? undefined,
      pendingUpdates: 0,
      status: 'synced',
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
        `${dropped.length} removed`,
    );
  } catch (err) {
    // A cancelled sync is not an error state — leave the profile as it was
    // rather than flagging it red for a choice the user made deliberately.
    //
    // It is still thrown on. Returning here made a cancelled sync look like a
    // finished one to whoever called, and the caller that matters is a launch:
    // pressing Cancel while the mods were being checked stopped the check and
    // then started the game anyway, on whatever half of the update had landed.
    if (isCancellation(err)) {
      log.info(`Manifest sync cancelled for ${profile.name}`);
      await writeSyncState(profileId, previousState);
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    await writeSyncState(profileId, {
      ...previousState,
      status: 'error',
      errorMessage: message,
    });
    throw err;
  } finally {
    endJob(profileId, signal);
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
 * case: a jar a pack carried inside itself is recorded under a `bundled-…` id,
 * and the build replacing it is a Modrinth project with a project id of its
 * own. Without this the entry would be appended beside the old one, leaving the
 * profile with two records and two jars of the same mod.
 */
export async function installResolvedMod(
  profileId: string,
  identity: { id: string; name: string; source: InstalledMod['source'] },
  resolved: { url: string; fileName: string; version: string; hashes: HashedEntry },
  replaces?: string,
): Promise<InstalledMod> {
  const modsDir = paths.profileModsDir(profileId);
  await fs.mkdir(modsDir, { recursive: true });

  // A mod the player switched off stays off across an update, the same rule a
  // pack sync follows. Written under its plain name regardless, the new build
  // came back enabled and the old one was left behind as `<name>.jar.disabled`.
  const replacedId = replaces ?? identity.id;
  const enabled = (await readLockFile(profileId)).find((m) => m.id === replacedId)?.enabled ?? true;
  const destPath = modFilePath(modsDir, resolved.fileName, enabled);

  log.info(`Installing mod ${identity.name} (${resolved.fileName}) from ${identity.source}`);
  // Checked against the hash Modrinth publishes for the build before it takes
  // its place, so an update that arrives wrong leaves the old jar standing.
  await downloadToFile(resolved.url, destPath, {
    secure: true,
    verify: { hashes: resolved.hashes, label: identity.name },
  });

  const installed: InstalledMod = {
    id: identity.id,
    name: identity.name,
    version: resolved.version,
    source: identity.source,
    fileName: resolved.fileName,
    enabled,
    fromManifest: false,
  };

  await mutateLockFile(profileId, async (mods) => {
    const idx = mods.findIndex((m) => m.id === replacedId);
    if (idx >= 0) {
      // The file this build replaces — unless it is the same file. Plenty of
      // projects republish under one name, and deleting "the old jar" by that
      // name then deleted the new one: the list said updated and `mods/` no
      // longer held the mod.
      const previous = mods[idx];
      if (!isSameModFile(previous.fileName, resolved.fileName)) {
        await fs.rm(modFilePath(modsDir, previous.fileName, previous.enabled), { force: true });
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
  await installResolvedMod(
    profileId,
    { id: mod.id, name: mod.name, source: 'modrinth' },
    downloadFor(version),
  );
  return { dependencies: await installRequiredDependencies(profileId, version) };
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
 * Install everything a build cannot start without into the profile: what it
 * requires, and what those require in turn.
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

  const { resolved, unresolved } = await resolveDependencies(
    version,
    profile,
    await readLockFile(profileId),
  );
  for (const name of unresolved) {
    log.warn(`Dependency ${name} has no build for MC ${profile.minecraftVersion}`);
  }

  const added: string[] = [];
  for (const dep of resolved) {
    await installModrinthVersion(profileId, dep.projectId, dep.name, dep.version);
    added.push(dep.name);
  }
  return added;
}

export async function uninstallMod(profileId: string, modId: string): Promise<void> {
  const modsDir = paths.profileModsDir(profileId);
  const name = await mutateLockFile(profileId, async (mods) => {
    const idx = mods.findIndex((m) => m.id === modId);
    if (idx < 0) throw new Error(`Mod ${modId} not found in profile ${profileId}`);
    const mod = mods[idx];

    // A file that is already gone is fine; one that would not go is not. It
    // used to be dropped from the list either way, and the jar the game went
    // on loading was then in no list at all.
    await fs.rm(modFilePath(modsDir, mod.fileName, mod.enabled), { force: true });

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
