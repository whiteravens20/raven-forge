import {
  CURSEFORGE_API_BASE,
  CURSEFORGE_GAME_ID,
  CURSEFORGE_CLASS_MODS,
} from '../../shared/constants';
import { getSettings } from '../config/settings-manager';
import type { ModLoaderType, ModSearchFilters, ModSearchResult } from '../../shared/ipc-types';

/**
 * CurseForge requires a per-developer API key, which this launcher cannot ship
 * — keys are issued to a person, and a key baked into a public binary is a
 * revoked key. The user supplies their own under Settings, so every call here
 * has to cope with there being none.
 */
export class CurseForgeKeyMissingError extends Error {
  constructor() {
    super('No CurseForge API key configured');
    this.name = 'CurseForgeKeyMissingError';
  }
}

/** True when the user has configured a key; the UI uses this to explain itself. */
export async function hasApiKey(): Promise<boolean> {
  const settings = await getSettings();
  return Boolean(settings.curseforgeApiKey?.trim());
}

async function curseforgeFetch(endpoint: string): Promise<Response> {
  const settings = await getSettings();
  const apiKey = settings.curseforgeApiKey?.trim();
  if (!apiKey) throw new CurseForgeKeyMissingError();

  const res = await fetch(`${CURSEFORGE_API_BASE}${endpoint}`, {
    headers: {
      'x-api-key': apiKey,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error('CurseForge rejected the API key — check it under Settings');
  }
  if (!res.ok) {
    throw new Error(`CurseForge API error (${endpoint}): ${res.status} ${res.statusText}`);
  }

  return res;
}

// ── Types from the CurseForge API ──────────────────────────
// Only the fields actually consumed here are declared.

interface CurseForgeSearchResponse {
  data: CurseForgeMod[];
}

interface CurseForgeMod {
  id: number;
  slug: string;
  name: string;
  summary: string;
  downloadCount: number;
  authors: { name: string }[];
  logo: { thumbnailUrl: string } | null;
  categories: { name: string }[];
  latestFilesIndexes: { gameVersion: string }[];
}

interface CurseForgeFilesResponse {
  data: CurseForgeFile[];
}

export interface CurseForgeFile {
  id: number;
  displayName: string;
  fileName: string;
  /**
   * Null when the project's author has opted out of third-party distribution.
   * CurseForge still lists the file; it just refuses to serve it to anyone but
   * their own client. There is no workaround, only a clear error.
   */
  downloadUrl: string | null;
  gameVersions: string[];
  /** `algo`: 1 = SHA1, 2 = MD5. CurseForge publishes nothing stronger. */
  hashes: { value: string; algo: number }[];
  fileDate: string;
}

// ── Loader mapping ─────────────────────────────────────────
// CurseForge identifies loaders by a numeric enum rather than by name.
const LOADER_TYPE: Partial<Record<ModLoaderType, number>> = {
  forge: 1,
  fabric: 4,
  quilt: 5,
  neoforge: 6,
};

// ── Search ─────────────────────────────────────────────────

export async function searchMods(filters: ModSearchFilters): Promise<ModSearchResult[]> {
  const params = new URLSearchParams({
    gameId: String(CURSEFORGE_GAME_ID),
    classId: String(CURSEFORGE_CLASS_MODS),
    searchFilter: filters.query,
    sortField: '2', // Popularity
    sortOrder: 'desc',
    pageSize: String(filters.limit ?? 20),
    index: String(filters.offset ?? 0),
  });
  if (filters.gameVersion) params.set('gameVersion', filters.gameVersion);

  const loaderType = filters.loader ? LOADER_TYPE[filters.loader] : undefined;
  if (loaderType !== undefined) params.set('modLoaderType', String(loaderType));

  const res = await curseforgeFetch(`/mods/search?${params}`);
  const data = (await res.json()) as CurseForgeSearchResponse;

  return data.data.map((mod) => ({
    id: String(mod.id),
    slug: mod.slug,
    name: mod.name,
    description: mod.summary,
    author: mod.authors[0]?.name ?? 'Unknown',
    iconUrl: mod.logo?.thumbnailUrl ?? undefined,
    downloads: mod.downloadCount,
    source: 'curseforge' as const,
    // Deduplicated: latestFilesIndexes lists one entry per file *per* loader,
    // so a mod shipping Fabric and Forge builds repeats every game version.
    versions: [...new Set(mod.latestFilesIndexes.map((f) => f.gameVersion))],
    categories: mod.categories.map((c) => c.name),
  }));
}

// ── File listing ───────────────────────────────────────────

export async function getModFiles(
  modId: string,
  gameVersion?: string,
  loader?: ModLoaderType,
): Promise<CurseForgeFile[]> {
  const params = new URLSearchParams({ pageSize: '50' });
  if (gameVersion) params.set('gameVersion', gameVersion);

  const loaderType = loader ? LOADER_TYPE[loader] : undefined;
  if (loaderType !== undefined) params.set('modLoaderType', String(loaderType));

  const res = await curseforgeFetch(`/mods/${modId}/files?${params}`);
  const data = (await res.json()) as CurseForgeFilesResponse;

  // Newest first. The API's default ordering is not documented as stable, and
  // "the latest compatible build" is the only thing callers here want.
  return data.data.sort((a, b) => Date.parse(b.fileDate) - Date.parse(a.fileDate));
}

// ── Download resolution ────────────────────────────────────

export interface CurseForgeDownload {
  url: string;
  fileName: string;
  version: string;
  /** CurseForge publishes SHA1 at best — never sha256/sha512. */
  sha1?: string;
}

/**
 * Resolve one installable file for a mod, newest compatible build first.
 *
 * `version` pins a specific build; without it the newest file matching the
 * profile's game version and loader wins. It is matched against the numeric
 * file id first and the display name second, mirroring how Modrinth entries
 * accept either an opaque version id or a human version number — a manifest
 * should not have to know which form this source uses.
 *
 * A pinned version that matches nothing is an error rather than a silent
 * fallback to "newest": a manifest pins a build for a reason.
 */
export async function resolveDownload(
  modId: string,
  gameVersion?: string,
  loader?: ModLoaderType,
  version?: string,
): Promise<CurseForgeDownload> {
  const files = await getModFiles(modId, gameVersion, loader);
  const file = version
    ? files.find((f) => String(f.id) === version || f.displayName === version)
    : files[0];

  if (!file) {
    throw new Error(
      version
        ? `No CurseForge build "${version}" for mod ${modId} on MC ${gameVersion ?? 'any'} / ${loader ?? 'any loader'}`
        : `No CurseForge build for MC ${gameVersion ?? 'any'} / ${loader ?? 'any loader'}`,
    );
  }

  if (!file.downloadUrl) {
    throw new Error(
      `${file.fileName}: the author has disabled third-party downloads on CurseForge. ` +
        'Download it manually and add it as a local file.',
    );
  }

  return {
    url: file.downloadUrl,
    fileName: file.fileName,
    version: file.displayName || String(file.id),
    sha1: file.hashes.find((h) => h.algo === 1)?.value.toLowerCase(),
  };
}
