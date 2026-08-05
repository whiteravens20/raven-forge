import { acceptedLoaders } from '../../shared/constants';
import { getModVersions, getProjectTitle, type ModrinthVersion } from './modrinth-api';
import type {
  CompatibilityIssue,
  InstallPlan,
  InstalledMod,
  ModSearchResult,
  PlannedDependency,
  Profile,
} from '../../shared/ipc-types';

/**
 * Deciding whether a download fits a profile, before it is downloaded.
 *
 * Installing the wrong file is not a loud failure. A Forge jar in a Fabric
 * profile is skipped in silence, a mod missing its API dependency takes the game
 * down during startup with a stack trace naming a class nobody recognises, and
 * two conflicting rendering mods produce a crash that looks like a graphics
 * driver problem. All three are visible in Modrinth's metadata beforehand, so
 * they are worth reading before writing anything to disk.
 *
 * Nothing here refuses. Every check produces an {@link CompatibilityIssue} for
 * the UI to present, because the metadata is a publisher's claim rather than a
 * fact — mods routinely work on Minecraft versions their author never listed —
 * and a launcher that knows better than the player is a launcher people work
 * around. The exception is a project with no usable build at all: there is
 * nothing to install and nothing to decide.
 */

/** Enough of a profile to judge compatibility against. */
type ProfileTarget = Pick<Profile, 'minecraftVersion' | 'modLoader'>;

/** How many Minecraft versions to name when reporting what a project does support. */
const SUPPORTED_VERSIONS_SHOWN = 3;

// ── Dependencies ───────────────────────────────────────────

/**
 * The required dependencies of a build that are not already in the profile.
 *
 * One level deep, deliberately. Modrinth's `required` edges are shallow in
 * practice — a mod needs Fabric API, an addon needs the mod it extends — and
 * those dependencies declare their own, so the transitive case resolves itself
 * the moment each one is installed by the same path. A full graph walk would be
 * machinery built for a shape that does not occur.
 */
export function requiredDependencies(
  version: ModrinthVersion,
  installed: Array<{ id: string }>,
): Array<{ projectId: string; versionId: string | null }> {
  return version.dependencies
    .filter((d) => d.dependency_type === 'required' && d.project_id)
    .filter((d) => !installed.some((m) => m.id === d.project_id))
    .map((d) => ({ projectId: d.project_id as string, versionId: d.version_id }));
}

/**
 * Installed mods this build declares it cannot run beside.
 *
 * Only the build's own declaration is read, not the reverse. Catching "something
 * already installed forbids *this*" would mean fetching the current build of
 * every mod in the profile on every check — a request per installed mod, for a
 * direction publishers rarely use, since the newer project is the one that knows
 * what it replaces. Embeddium naming Rubidium is the shape this catches.
 */
function conflictingWith(version: ModrinthVersion, installed: InstalledMod[]): string[] {
  return (
    version.dependencies
      .filter((d) => d.dependency_type === 'incompatible' && d.project_id)
      .map((d) => installed.find((m) => m.id === d.project_id))
      .filter((m): m is InstalledMod => Boolean(m))
      // The installed name is already on hand and is what the player sees in
      // their own list — no reason to ask Modrinth what it calls that project.
      .map((m) => m.name)
  );
}

/**
 * Resolve each missing dependency to a build for this profile.
 *
 * A dependency with no build is reported rather than skipped: it is the reason
 * the mod will fail to start, and finding that out from a crash log after the
 * fact is exactly what this whole module exists to avoid.
 */
async function planDependencies(
  version: ModrinthVersion,
  target: ProfileTarget,
  installed: InstalledMod[],
): Promise<{ dependencies: PlannedDependency[]; unresolved: string[] }> {
  const loaders = acceptedLoaders(target.modLoader);
  const dependencies: PlannedDependency[] = [];
  const unresolved: string[] = [];

  for (const dep of requiredDependencies(version, installed)) {
    // The project's title, not the build's. `ModrinthVersion.name` is a label
    // like "[1.21.4] Sodium 0.6.5", which reads badly in a sentence.
    const name = await getProjectTitle(dep.projectId);
    const candidates = await getModVersions(dep.projectId, target.minecraftVersion, loaders);
    // A pinned `version_id` is the publisher saying *this* build; honour it when
    // it is among the ones that fit, and fall back to newest when it is not.
    const match = dep.versionId
      ? (candidates.find((v) => v.id === dep.versionId) ?? candidates[0])
      : candidates[0];

    if (match) {
      dependencies.push({ id: dep.projectId, name, version: match.version_number || match.id });
    } else {
      unresolved.push(name);
    }
  }

  return { dependencies, unresolved };
}

// ── Choosing a build ───────────────────────────────────────

/**
 * The newest Minecraft versions a set of builds covers, newest first.
 *
 * Both loops run from the newest end. Modrinth returns builds newest first but
 * lists each build's own `game_versions` oldest first, so reading that array
 * forwards would answer "what does it support?" with 1.7.10 — true of a shader
 * pack with seventy-five entries, and useless.
 */
function versionsCovered(versions: ModrinthVersion[]): string[] {
  const seen = new Set<string>();
  for (const version of versions) {
    for (const game of [...version.game_versions].reverse()) {
      seen.add(game);
      if (seen.size >= SUPPORTED_VERSIONS_SHOWN) return [...seen];
    }
  }
  return [...seen];
}

/** Every loader a set of builds is published for. */
function loadersCovered(versions: ModrinthVersion[]): string[] {
  return [...new Set(versions.flatMap((v) => v.loaders))].sort();
}

/**
 * Find the best build for a profile, and say what is wrong when there is no
 * exact fit.
 *
 * Widening happens one axis at a time so the answer can name which axis failed.
 * "No Fabric build for 1.21.4" and "no 1.21.4 build at all" are different
 * problems with different fixes — change the profile's loader, or wait for the
 * author — and collapsing them into "not compatible" throws away the only part
 * the player can act on.
 */
async function chooseBuild(
  projectId: string,
  target: ProfileTarget,
  loaderMatters: boolean,
): Promise<{ version?: ModrinthVersion; issues: CompatibilityIssue[] }> {
  const loaders = loaderMatters ? acceptedLoaders(target.modLoader) : [];
  const issues: CompatibilityIssue[] = [];

  // A mod on a vanilla profile has nothing to load it. Worth saying plainly,
  // and worth saying before the version questions, which are beside the point.
  if (loaderMatters && loaders.length === 0) issues.push({ kind: 'needs-loader' });

  const exact = await getModVersions(projectId, target.minecraftVersion, loaders);
  if (exact[0]) return { version: exact[0], issues };

  // Right Minecraft version, wrong loader.
  if (loaders.length > 0) {
    const anyLoader = await getModVersions(projectId, target.minecraftVersion);
    if (anyLoader[0]) {
      return {
        version: anyLoader[0],
        issues: [...issues, { kind: 'wrong-loader', supported: loadersCovered(anyLoader) }],
      };
    }
  }

  // Right loader, wrong Minecraft version.
  const anyVersion = await getModVersions(projectId, undefined, loaders);
  if (anyVersion[0]) {
    return {
      version: anyVersion[0],
      issues: [...issues, { kind: 'wrong-version', supported: versionsCovered(anyVersion) }],
    };
  }

  // Neither axis fits. One last unfiltered look decides between "wrong on both
  // counts" and a project with genuinely nothing published.
  const all = loaders.length > 0 ? await getModVersions(projectId) : [];
  if (all[0]) {
    return {
      version: all[0],
      issues: [
        ...issues,
        { kind: 'wrong-loader', supported: loadersCovered(all) },
        { kind: 'wrong-version', supported: versionsCovered(all) },
      ],
    };
  }

  return { issues: [...issues, { kind: 'no-build' }] };
}

// ── Public API ─────────────────────────────────────────────

/**
 * Work out what installing a mod into a profile would do.
 *
 * Costs one Modrinth request when everything fits, which is the common case;
 * the extra lookups only happen once something is already known to be wrong.
 */
export async function planModInstall(
  target: ProfileTarget,
  mod: Pick<ModSearchResult, 'id' | 'name'>,
  installed: InstalledMod[],
): Promise<InstallPlan> {
  const { version, issues } = await chooseBuild(mod.id, target, true);
  if (!version) return { name: mod.name, dependencies: [], issues };

  const conflicts = await conflictingWith(version, installed);
  if (conflicts.length > 0) issues.push({ kind: 'conflicts-with', names: conflicts });

  const { dependencies, unresolved } = await planDependencies(version, target, installed);
  if (unresolved.length > 0) issues.push({ kind: 'dependency-no-build', names: unresolved });

  return {
    name: mod.name,
    versionId: version.id,
    versionName: version.version_number || version.id,
    dependencies,
    issues,
  };
}

/**
 * The same for a shader pack or a resource pack.
 *
 * Only the Minecraft version is asked about. Neither kind has a mod loader —
 * Modrinth files resource packs under `minecraft` and shaders under the shader
 * loader that renders them (`iris`, `optifine`), which is a separate question
 * answered by the shader loader picker, not by this. Dependencies are not
 * considered for the same reason: neither kind is loaded by anything that could
 * resolve one.
 */
export async function planContentInstall(
  target: ProfileTarget,
  item: Pick<ModSearchResult, 'id' | 'name'>,
): Promise<InstallPlan> {
  const { version, issues } = await chooseBuild(item.id, target, false);
  return {
    name: item.name,
    versionId: version?.id,
    versionName: version ? version.version_number || version.id : undefined,
    dependencies: [],
    issues,
  };
}
