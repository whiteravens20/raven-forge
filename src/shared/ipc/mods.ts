// Mods, shaders and resource packs — searching, installing, compatibility.
// Part of the IPC contract — see `../ipc-types.ts`.

import type { ModLoaderType } from './profiles';

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
