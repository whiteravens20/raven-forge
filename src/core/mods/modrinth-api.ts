import { MODRINTH_API_BASE, isClientModLoader } from '../../shared/constants';
import { modrinthUserAgent } from '../net/user-agent';
import { isSafeFileName } from '../../shared/manifest-schema';
import type {
  ContentProjectType,
  FacetGroups,
  ModSearchFilters,
  ModSearchResult,
} from '../../shared/ipc-types';

// ── Modrinth API helpers ───────────────────────────────────

async function modrinthFetch(endpoint: string): Promise<Response> {
  const res = await fetch(`${MODRINTH_API_BASE}${endpoint}`, {
    headers: {
      'User-Agent': modrinthUserAgent(),
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Modrinth API error (${endpoint}): ${res.status} ${res.statusText}`);
  }

  return res;
}

/**
 * The same, for the two endpoints that take a list of file hashes.
 *
 * They are POSTs because the list is the request body, not because anything is
 * created — nothing here writes to Modrinth, and no token is ever sent.
 */
async function modrinthPost(endpoint: string, body: unknown): Promise<Response> {
  const res = await fetch(`${MODRINTH_API_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'User-Agent': modrinthUserAgent(),
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Modrinth API error (${endpoint}): ${res.status} ${res.statusText}`);
  }

  return res;
}

// ── Types from Modrinth API ────────────────────────────────

interface ModrinthSearchResponse {
  hits: ModrinthSearchHit[];
  offset: number;
  limit: number;
  total_hits: number;
}

interface ModrinthSearchHit {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  icon_url: string | null;
  downloads: number;
  versions: string[];
  categories: string[];
  project_type: string;
}

export interface ModrinthVersion {
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  files: ModrinthFile[];
  dependencies: ModrinthDependency[];
}

export interface ModrinthFile {
  hashes: { sha1: string; sha512: string };
  url: string;
  filename: string;
  primary: boolean;
  size: number;
}

interface ModrinthDependency {
  version_id: string | null;
  project_id: string | null;
  dependency_type: 'required' | 'optional' | 'incompatible' | 'embedded';
}

// ── Search ─────────────────────────────────────────────────

export async function searchMods(filters: ModSearchFilters): Promise<ModSearchResult[]> {
  const projectType = filters.projectType ?? 'mod';

  const facets: string[][] = [];
  facets.push([`project_type:${projectType}`]);
  if (filters.gameVersion) facets.push([`versions:${filters.gameVersion}`]);
  // A loader facet only means anything for mods. Resource packs have no loader,
  // and shaders are categorised by the shader loader that runs them (iris,
  // optifine) — facetting those on `fabric` returns nothing at all.
  if (filters.loader && projectType === 'mod') facets.push([`categories:${filters.loader}`]);
  // Each category becomes its own facet group, which Modrinth ANDs: asking for
  // `iris` and `realistic` means both, not either.
  for (const category of filters.categories ?? []) facets.push([`categories:${category}`]);

  const params = new URLSearchParams({
    query: filters.query,
    facets: JSON.stringify(facets),
    limit: String(filters.limit ?? 20),
    offset: String(filters.offset ?? 0),
  });

  const res = await modrinthFetch(`/search?${params}`);
  const data = (await res.json()) as ModrinthSearchResponse;

  return data.hits.map((hit) => ({
    id: hit.project_id,
    slug: hit.slug,
    name: hit.title,
    description: hit.description,
    author: hit.author,
    iconUrl: hit.icon_url ?? undefined,
    downloads: hit.downloads,
    source: 'modrinth' as const,
    versions: hit.versions,
    categories: hit.categories,
  }));
}

/**
 * Resolutions are a magnitude, and sorting them as text puts 128x first and
 * 8x- last. Everything else is fine alphabetically.
 */
function sortFacetGroup(header: string, names: string[]): string[] {
  if (header !== 'resolutions') return [...names].sort();
  const magnitude = (n: string) => parseInt(n.replace(/[^0-9]/g, ''), 10) || 0;
  return [...names].sort((a, b) => magnitude(a) - magnitude(b));
}

/**
 * The facets Modrinth will actually accept for a project type, grouped the way
 * Modrinth itself groups them.
 *
 * The grouping is the point. `/tag/category` returns one flat list in which
 * `16x`, `audio` and `combat` are indistinguishable, but they are three
 * different questions — how sharp, what it touches, what it looks like — and
 * flattening them into one control makes the common ask ("32x *and*
 * vanilla-like") impossible to express. The `header` field is what separates
 * them: `resolutions` / `features` / `categories` for resource packs,
 * `features` / `categories` / `performance impact` for shaders.
 *
 * Fetched rather than hardcoded: these lists move (shaders gained
 * `path-tracing`), and a stale hardcoded entry silently returns nothing for an
 * option still on offer.
 *
 * Loaders come from a separate endpoint but land in the same `categories` facet
 * at search time, which is why they are returned alongside.
 */
export async function getSearchFacets(projectType: ContentProjectType): Promise<FacetGroups> {
  const [catRes, loaderRes, versionRes] = await Promise.all([
    modrinthFetch('/tag/category'),
    modrinthFetch('/tag/loader'),
    modrinthFetch('/tag/game_version'),
  ]);

  const grouped = new Map<string, string[]>();
  for (const tag of (await catRes.json()) as Array<{
    name: string;
    header: string;
    project_type: string;
  }>) {
    if (tag.project_type !== projectType) continue;
    const names = grouped.get(tag.header) ?? [];
    names.push(tag.name);
    grouped.set(tag.header, names);
  }

  const loaders = (
    (await loaderRes.json()) as Array<{
      name: string;
      supported_project_types: string[];
    }>
  )
    .filter((l) => l.supported_project_types.includes(projectType))
    // A launcher starts a client, so the server platforms Modrinth also files
    // under `mod` (bukkit, paper, velocity …) would only be dead options.
    .filter((l) => projectType !== 'mod' || isClientModLoader(l.name))
    .map((l) => l.name)
    .sort();

  // Releases only. Snapshots outnumber releases eight to one, and nobody picks
  // a profile's Minecraft version from a list of 900 entries.
  const gameVersions = (
    (await versionRes.json()) as Array<{ version: string; version_type: string }>
  )
    .filter((v) => v.version_type === 'release')
    .map((v) => v.version);

  return {
    loaders,
    gameVersions,
    groups: [...grouped].map(([header, names]) => ({
      header,
      names: sortFacetGroup(header, names),
    })),
  };
}

// ── Version listing ────────────────────────────────────────

/**
 * A project's builds, newest first, optionally narrowed to a Minecraft version
 * and a set of loaders.
 *
 * `loaders` takes a list because a profile can accept more than one — Quilt runs
 * Fabric mods — and because asking twice and merging would lose Modrinth's own
 * ordering. An empty list is treated as no filter rather than as "match
 * nothing", so a vanilla profile still sees what exists.
 */
export async function getModVersions(
  projectId: string,
  gameVersion?: string,
  loaders?: string | string[],
): Promise<ModrinthVersion[]> {
  const params = new URLSearchParams();
  if (gameVersion) params.set('game_versions', JSON.stringify([gameVersion]));
  const loaderList = typeof loaders === 'string' ? [loaders] : (loaders ?? []);
  if (loaderList.length > 0) params.set('loaders', JSON.stringify(loaderList));

  const res = await modrinthFetch(`/project/${projectId}/version?${params}`);
  return (await res.json()) as ModrinthVersion[];
}

/**
 * One specific build, by id.
 *
 * Needed wherever the caller has already decided which build to install and the
 * filtered listing would not contain it — installing a mod past a compatibility
 * warning is exactly that case.
 */
export async function getVersion(versionId: string): Promise<ModrinthVersion> {
  const res = await modrinthFetch(`/version/${versionId}`);
  return (await res.json()) as ModrinthVersion;
}

// ── Lookup by file hash ────────────────────────────────────

/**
 * How many hashes go in one request.
 *
 * Modrinth accepts far more, but a profile with three hundred mods should not
 * become one enormous request that either times out whole or succeeds whole.
 */
const HASH_BATCH = 100;

/** Both hash endpoints answer with the same map, and take the same batching. */
async function byHash(
  endpoint: string,
  hashes: string[],
  extra: Record<string, unknown> = {},
): Promise<Map<string, ModrinthVersion>> {
  const found = new Map<string, ModrinthVersion>();

  for (let i = 0; i < hashes.length; i += HASH_BATCH) {
    const batch = hashes.slice(i, i + HASH_BATCH);
    const res = await modrinthPost(endpoint, { hashes: batch, algorithm: 'sha512', ...extra });
    const data = (await res.json()) as Record<string, ModrinthVersion>;
    // Keyed by the hash that was *sent*, so a file Modrinth has never seen is
    // simply absent rather than reported as anything.
    for (const [hash, version] of Object.entries(data)) found.set(hash, version);
  }

  return found;
}

/**
 * Which Modrinth build each of these files *is*.
 *
 * The identity of a jar is its contents, which is what makes this work on a mod
 * the launcher did not install: a file dropped into `mods/` by hand carries no
 * project id, no version and no URL, and this recovers all three from the bytes.
 */
export async function versionsByHash(hashes: string[]): Promise<Map<string, ModrinthVersion>> {
  return byHash('/version_files', hashes);
}

/**
 * The newest build of whatever project each of these files belongs to.
 *
 * Narrowed to the profile's Minecraft version and loaders, so "newest" means
 * newest *that this profile could run* — without that, a 1.21.4 profile is
 * offered the 1.22 build and updating breaks the game.
 *
 * The reply is the newest match, which is very often the file that was sent.
 * Callers decide what counts as an update by comparing hashes, not version
 * strings: a project that relabels a build without republishing it would
 * otherwise read as an update forever.
 */
export async function latestVersionsByHash(
  hashes: string[],
  loaders: string[],
  gameVersions: string[],
): Promise<Map<string, ModrinthVersion>> {
  return byHash('/version_files/update', hashes, { loaders, game_versions: gameVersions });
}

/**
 * A project's display title. Version names are build labels, not this.
 *
 * Memoised for the life of the process. Titles are the one thing Modrinth
 * publishes that effectively never changes, and this is called once per
 * dependency — so installing several mods that share Fabric API and Sodium
 * re-asked for the same two projects on every one of them.
 */
const projectTitles = new Map<string, Promise<string>>();

export async function getProjectTitle(projectId: string): Promise<string> {
  const cached = projectTitles.get(projectId);
  if (cached) return cached;

  // The promise is cached, not the result, so concurrent callers share one
  // request instead of racing to make the same one.
  const pending = modrinthFetch(`/project/${projectId}`)
    .then(async (res) => ((await res.json()) as { title: string }).title)
    .catch((err: unknown) => {
      // A failure must not be remembered, or one flaky request would poison the
      // name of that project until the launcher restarts.
      projectTitles.delete(projectId);
      throw err;
    });

  projectTitles.set(projectId, pending);
  return pending;
}

/**
 * The file a version is, out of the extras (sources, javadoc) it may also carry.
 *
 * The name is checked here rather than at each of the three call sites that
 * turn it into a path (`mods/`, `shaderpacks/`, `resourcepacks/`). A manifest is
 * held to this rule by `fileNameField` and a local install by `path.basename`;
 * this was the one route that took a remote API at its word. Modrinth over
 * HTTPS is a trusted upstream and no live abuse of it is claimed — the point is
 * that the rule holds everywhere a name becomes a path, not only where an
 * attacker is currently expected.
 */
export function primaryFile(version: ModrinthVersion): ModrinthFile {
  const primary = version.files.find((f) => f.primary) ?? version.files[0];
  if (!primary) throw new Error(`No files found for version ${version.id}`);
  if (!isSafeFileName(primary.filename)) {
    throw new Error(
      `Modrinth version ${version.id} names its file ${JSON.stringify(primary.filename)}, ` +
        'which is not a plain file name',
    );
  }
  return primary;
}
