import fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { log } from '../../main/logger';
import { paths } from '../config/paths';
import { MOJANG_VERSION_MANIFEST } from '../../shared/constants';
import type { VersionManifest, VersionMeta, VersionEntry } from './types';

const MANIFEST_CACHE_FILE = 'version_manifest_v2.json';
const MANIFEST_MAX_AGE_MS = 10 * 60 * 1000; // 10 min

let cachedManifest: VersionManifest | null = null;
let cachedAt = 0;

/**
 * Fetch version manifest from Mojang, with disk + memory caching.
 */
export async function getVersionManifest(forceRefresh = false): Promise<VersionManifest> {
  if (!forceRefresh && cachedManifest && Date.now() - cachedAt < MANIFEST_MAX_AGE_MS) {
    return cachedManifest;
  }

  const cacheFile = path.join(paths.cacheDir, MANIFEST_CACHE_FILE);

  // Try disk cache. One handle serves both the freshness check and the read:
  // stat-then-open asks about one file and reads whatever is at that path a
  // moment later, which is not necessarily the same file.
  if (!forceRefresh) {
    let handle: FileHandle | undefined;
    try {
      handle = await fs.open(cacheFile, 'r');
      const stat = await handle.stat();
      if (Date.now() - stat.mtimeMs < MANIFEST_MAX_AGE_MS) {
        const raw = await handle.readFile('utf-8');
        cachedManifest = JSON.parse(raw) as VersionManifest;
        cachedAt = Date.now();
        return cachedManifest;
      }
    } catch {
      /* no cache */
    } finally {
      await handle?.close();
    }
  }

  // Fetch from Mojang
  log.info('Fetching Minecraft version manifest from Mojang...');
  const res = await fetch(MOJANG_VERSION_MANIFEST, {
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch version manifest: ${res.status}`);
  }

  const manifest = (await res.json()) as VersionManifest;

  // Write to cache
  await fs.mkdir(paths.cacheDir, { recursive: true });
  await fs.writeFile(cacheFile, JSON.stringify(manifest), 'utf-8');

  cachedManifest = manifest;
  cachedAt = Date.now();
  return manifest;
}

/**
 * Find a version entry by ID.
 */
export async function findVersion(versionId: string): Promise<VersionEntry | undefined> {
  const manifest = await getVersionManifest();
  return manifest.versions.find((v) => v.id === versionId);
}

/**
 * Fetch full version meta JSON for a specific version.
 *
 * Only resolves vanilla versions listed in Mojang's manifest. Loader versions
 * (Fabric/Quilt profile JSONs) are resolved by the modloader layer and merged
 * on top of their parent via {@link mergeVersionMeta}.
 */
export async function getVersionMeta(versionId: string): Promise<VersionMeta> {
  const cacheFile = path.join(paths.cacheDir, `${versionId}.json`);

  // Disk cache (version JSONs are immutable)
  try {
    const raw = await fs.readFile(cacheFile, 'utf-8');
    return JSON.parse(raw) as VersionMeta;
  } catch {
    /* miss */
  }

  const entry = await findVersion(versionId);
  if (!entry) {
    throw new Error(`Minecraft version ${versionId} not found in manifest`);
  }

  log.info(`Fetching version meta for ${versionId}...`);
  const res = await fetch(entry.url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    throw new Error(`Failed to fetch version meta for ${versionId}: ${res.status}`);
  }

  const meta = (await res.json()) as VersionMeta;

  await fs.mkdir(paths.cacheDir, { recursive: true });
  await fs.writeFile(cacheFile, JSON.stringify(meta), 'utf-8');

  return meta;
}

// ── Version inheritance (inheritsFrom) ─────────────────────
// Mod loader profiles (Fabric, Quilt, Forge) are partial version JSONs that
// declare `inheritsFrom: "<vanilla id>"`. They contribute their own libraries,
// mainClass and extra arguments, and inherit everything else from the parent.

/**
 * Dedupe key for libraries across the inheritance chain: `group:artifact` plus
 * the classifier when there is one.
 *
 * The classifier matters — modern versions list one entry per OS
 * (`com.mojang:jtracy:1.0.37:natives-linux`, `…:natives-windows`, …). Keying on
 * `group:artifact` alone would keep whichever came first and silently drop the
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
 * Child wins for scalar fields it defines. Libraries are concatenated with the
 * child first — the loader's own copies of shared artifacts (ASM, Guava, ...)
 * must take precedence on the classpath — and deduped by `group:artifact`.
 * Arguments are parent-then-child so loader tweaks are applied last.
 */
export function mergeVersionMeta(parent: VersionMeta, child: Partial<VersionMeta>): VersionMeta {
  const seen = new Set<string>();
  const libraries: VersionMeta['libraries'] = [];
  for (const lib of [...(child.libraries ?? []), ...parent.libraries]) {
    const key = libraryKey(lib.name);
    if (seen.has(key)) continue;
    seen.add(key);
    libraries.push(lib);
  }

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
