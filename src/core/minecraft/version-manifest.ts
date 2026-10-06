// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { log } from '../../main/logger';
import { paths } from '../config/paths';
import { MOJANG_VERSION_MANIFEST } from '../../shared/constants';
import { writeFileAtomic } from '../util/atomic-file';
import type { VersionManifest, VersionMeta, VersionEntry } from './types';

const MANIFEST_CACHE_FILE = 'version_manifest_v2.json';
const MANIFEST_MAX_AGE_MS = 10 * 60 * 1000; // 10 min
/** How long a copy that is past its age is used after Mojang could not be reached. */
const MANIFEST_RETRY_MS = 60 * 1000;

let cachedManifest: VersionManifest | null = null;
/** When `cachedManifest` stops being good enough to answer with. */
let cachedUntil = 0;

/** The list as it is on disk, and whether it is recent enough to use unasked. */
async function readManifestFile(
  cacheFile: string,
): Promise<{ manifest: VersionManifest; fresh: boolean } | null> {
  // One handle serves both the freshness check and the read: stat-then-open
  // asks about one file and reads whatever is at that path a moment later, which
  // is not necessarily the same file.
  let handle: FileHandle | undefined;
  try {
    handle = await fs.open(cacheFile, 'r');
    const stat = await handle.stat();
    const manifest = JSON.parse(await handle.readFile('utf-8')) as VersionManifest;
    return { manifest, fresh: Date.now() - stat.mtimeMs < MANIFEST_MAX_AGE_MS };
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

/**
 * Mojang's list of versions, from memory, from disk, or from Mojang.
 *
 * A copy past its age is still the answer when Mojang cannot be reached. Without
 * that the list of versions — and through `getVersionMeta` every launch — needed
 * the network ten minutes after the last time it had been there.
 */
export async function getVersionManifest(): Promise<VersionManifest> {
  if (cachedManifest && Date.now() < cachedUntil) return cachedManifest;

  const cacheFile = path.join(paths.cacheDir, MANIFEST_CACHE_FILE);
  const onDisk = await readManifestFile(cacheFile);
  if (onDisk?.fresh) {
    cachedManifest = onDisk.manifest;
    cachedUntil = Date.now() + MANIFEST_MAX_AGE_MS;
    return cachedManifest;
  }

  try {
    log.info('Fetching Minecraft version manifest from Mojang...');
    const res = await fetch(MOJANG_VERSION_MANIFEST, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Failed to fetch version manifest: ${res.status}`);

    const manifest = (await res.json()) as VersionManifest;
    await writeFileAtomic(cacheFile, JSON.stringify(manifest));
    cachedManifest = manifest;
    cachedUntil = Date.now() + MANIFEST_MAX_AGE_MS;
    return manifest;
  } catch (err) {
    const stale = onDisk?.manifest ?? cachedManifest;
    if (!stale) throw err;
    log.warn(`Could not refresh the version manifest, using the copy on disk: ${String(err)}`);
    cachedManifest = stale;
    // Not for the full ten minutes: the network may be back long before then.
    cachedUntil = Date.now() + MANIFEST_RETRY_MS;
    return stale;
  }
}

/**
 * Find a version entry by ID.
 */
async function findVersion(versionId: string): Promise<VersionEntry | undefined> {
  const manifest = await getVersionManifest();
  return manifest.versions.find((v) => v.id === versionId);
}

const sha1 = (text: string) => crypto.createHash('sha1').update(text).digest('hex');

const metaFile = (versionId: string) => path.join(paths.cacheDir, `${versionId}.json`);

async function readMetaFile(versionId: string): Promise<{ raw: string; meta: VersionMeta } | null> {
  try {
    const raw = await fs.readFile(metaFile(versionId), 'utf-8');
    return { raw, meta: JSON.parse(raw) as VersionMeta };
  } catch {
    return null;
  }
}

/**
 * Fetch full version meta JSON for a specific version.
 *
 * Only resolves vanilla versions listed in Mojang's manifest. Loader versions
 * (Fabric/Quilt profile JSONs) are resolved by the modloader layer and merged
 * on top of their parent via {@link mergeVersionMeta}.
 *
 * The copy on disk is used for as long as it is the file Mojang's list names.
 * It used to be kept for good, on the ground that a version's JSON never
 * changes — and they do: Mojang has reissued them in batches, in December 2021
 * with the logging configuration that answers Log4Shell, and again in 2023 and
 * 2026. A launcher that had fetched one before a reissue went on launching from
 * the old one. The list carries each file's sha1, so being current costs one
 * comparison; and when the list cannot be had, or the new file cannot, the copy
 * on disk is still what the game starts from.
 */
export async function getVersionMeta(versionId: string): Promise<VersionMeta> {
  const cached = await readMetaFile(versionId);

  let entry: VersionEntry | undefined;
  try {
    entry = await findVersion(versionId);
  } catch (err) {
    if (cached) return cached.meta;
    throw err;
  }
  if (!entry) {
    if (cached) return cached.meta;
    throw new Error(`Minecraft version ${versionId} not found in manifest`);
  }
  if (cached && sha1(cached.raw) === entry.sha1) return cached.meta;

  try {
    log.info(`Fetching version meta for ${versionId}...`);
    const res = await fetch(entry.url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Failed to fetch version meta for ${versionId}: ${res.status}`);

    // Kept byte for byte, so that what is on disk hashes to what the list says.
    const raw = await res.text();
    if (sha1(raw) !== entry.sha1) {
      throw new Error(`Version meta for ${versionId} is not the file Mojang's manifest names`);
    }
    const meta = JSON.parse(raw) as VersionMeta;
    await writeFileAtomic(metaFile(versionId), raw);
    return meta;
  } catch (err) {
    if (!cached) throw err;
    log.warn(
      `Could not refresh the version meta for ${versionId}, using the copy on disk: ${String(err)}`,
    );
    return cached.meta;
  }
}

// ── Version inheritance (inheritsFrom) ─────────────────────
// Mod loader profiles (Fabric, Quilt, Forge) are partial version JSONs that
// declare `inheritsFrom: "<vanilla id>"`. They contribute their own libraries,
// mainClass and extra arguments, and inherit everything else from the parent.

/**
 * What a child's library has to share with a parent's to replace it:
 * `group:artifact`, plus the classifier when there is one.
 *
 * The classifier matters — modern versions list one entry per OS
 * (`com.mojang:jtracy:1.0.37:natives-linux`, `…:natives-windows`, …). Keying on
 * `group:artifact` alone would let a loader's copy of one of them displace the
 * natives for every other platform.
 */
function libraryKey(name: string): string {
  const [group, artifact, , classifier] = name.split(':');
  if (!artifact) return name;
  return classifier ? `${group}:${artifact}:${classifier}` : `${group}:${artifact}`;
}

/**
 * Merge a child version meta (loader profile) onto its parent (vanilla).
 *
 * Child wins for scalar fields it defines. Libraries are the child's first —
 * the loader's own copies of shared artifacts (ASM, Guava, ...) must take
 * precedence on the classpath — followed by every parent library the child does
 * not define under the same {@link libraryKey}. Arguments are parent-then-child
 * so loader tweaks are applied last.
 *
 * Only the child displaces. This used to drop a repeated key wherever it came
 * from, parent against parent included, and Mojang repeats keys on purpose: from
 * 1.13 to 1.18.2 every LWJGL module is listed up to four times — the macOS
 * build, the build for everything else, and each of those again carrying its
 * `natives` — told apart by `rules`, not by name. The first of the four is the
 * macOS one, so that was the survivor, the rules then removed it on Linux and
 * Windows, and every modded profile on those versions started with no LWJGL on
 * the classpath at all. Vanilla never went through here and kept working.
 */
export function mergeVersionMeta(parent: VersionMeta, child: Partial<VersionMeta>): VersionMeta {
  const own = child.libraries ?? [];
  const replaced = new Set(own.map((lib) => libraryKey(lib.name)));
  const libraries: VersionMeta['libraries'] = [
    ...own,
    ...parent.libraries.filter((lib) => !replaced.has(libraryKey(lib.name))),
  ];

  const merged: VersionMeta = {
    ...parent,
    ...child,
    // `id` identifies the launched version; keep the child's (e.g. fabric-loader-…)
    id: child.id ?? parent.id,
    mainClass: child.mainClass ?? parent.mainClass,
    libraries,
  };

  // Loader profiles carry no assets/downloads of their own — never let an
  // absent child field blank out the parent's.
  merged.assetIndex = child.assetIndex ?? parent.assetIndex;
  merged.assets = child.assets ?? parent.assets;
  merged.downloads = child.downloads ?? parent.downloads;
  merged.javaVersion = child.javaVersion ?? parent.javaVersion;
  merged.logging = child.logging ?? parent.logging;

  if (parent.arguments || child.arguments) {
    merged.arguments = {
      game: [...(parent.arguments?.game ?? []), ...(child.arguments?.game ?? [])],
      jvm: [...(parent.arguments?.jvm ?? []), ...(child.arguments?.jvm ?? [])],
    };
  }

  // Legacy (pre-1.13) string argument form: child replaces wholesale if set.
  merged.minecraftArguments = child.minecraftArguments ?? parent.minecraftArguments;

  // The chain is resolved — don't let callers walk it twice.
  delete merged.inheritsFrom;

  return merged;
}

/**
 * Resolve a version meta's full `inheritsFrom` chain into a single flat meta.
 *
 * Accepts an already-loaded meta (typically a loader profile JSON) and walks up
 * to the vanilla root, merging each level onto the one below it.
 */
export async function resolveVersionChain(meta: VersionMeta, depth = 0): Promise<VersionMeta> {
  if (!meta.inheritsFrom) return meta;
  if (depth >= 8) {
    throw new Error(`Version inheritance chain too deep (possible cycle at ${meta.id})`);
  }

  log.info(`Resolving version ${meta.id} → inherits from ${meta.inheritsFrom}`);
  const parent = await resolveVersionChain(await getVersionMeta(meta.inheritsFrom), depth + 1);
  return mergeVersionMeta(parent, meta);
}
