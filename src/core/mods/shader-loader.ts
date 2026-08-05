import { log } from '../../main/logger';
import { getModVersions, getProjectTitle, type ModrinthVersion } from './modrinth-api';
import { getInstalledMods, installModrinthVersion } from './mod-sync';
import type {
  ModLoaderType,
  ShaderLoaderOption,
  ShaderLoaderResult,
  ShaderLoaderState,
} from '../../shared/ipc-types';

/**
 * Shaders are not something Minecraft loads on its own — they need a mod that
 * implements the shader pipeline. Installing a shader pack without one puts a
 * zip in `shaderpacks/` that nothing will ever read, which looks exactly like a
 * working install right up until the game starts.
 */
interface ShaderLoaderProject {
  /** Modrinth project id. Permanent; slugs are not. */
  id: string;
  name: string;
}

const IRIS: ShaderLoaderProject = { id: 'YL57xq9U', name: 'Iris Shaders' };
const OCULUS: ShaderLoaderProject = { id: 'GchcoXML', name: 'Oculus' };

/**
 * Which shader loaders can run on a mod loader, recommended first.
 *
 * Iris covers Fabric, Quilt and NeoForge; plain Forge is the one that needs
 * Oculus instead. Where both are listed the launcher does not pick — which
 * of them actually has a build is left to Modrinth, and which of those the
 * player wants is left to the player.
 */
export function shaderLoaderCandidates(modLoader: ModLoaderType): ShaderLoaderProject[] {
  switch (modLoader) {
    case 'fabric':
    case 'quilt':
      return [IRIS];
    case 'neoforge':
      return [IRIS, OCULUS];
    case 'forge':
      return [OCULUS];
    // Vanilla has no shader loader at all — there is nothing to install, and
    // saying so beats installing something that cannot load.
    default:
      return [];
  }
}

/**
 * What the profile can be offered, with every option confirmed to have a build.
 *
 * Resolved against Modrinth rather than against a version cutoff written here:
 * Iris gained NeoForge support partway through 1.21 and Oculus stopped at
 * 1.20.1, so any boundary hardcoded in this file would be wrong the moment
 * either project moves. An option that reaches the picker can be installed.
 */
export async function getShaderLoaderState(
  profileId: string,
  mcVersion: string,
  modLoader: ModLoaderType,
): Promise<ShaderLoaderState> {
  const candidates = shaderLoaderCandidates(modLoader);
  if (candidates.length === 0) return { status: 'unsupported', modLoader };

  const installed = await getInstalledMods(profileId);
  const present = candidates.find((c) => installed.some((m) => m.id === c.id));
  if (present) return { status: 'already-installed', name: present.name };

  const options: ShaderLoaderOption[] = [];
  for (const candidate of candidates) {
    const newest = (await getModVersions(candidate.id, mcVersion, modLoader))[0];
    if (!newest) continue;

    options.push({
      id: candidate.id,
      name: candidate.name,
      version: newest.version_number || newest.id,
      // Named up front so the dialog can say what else is coming. Iris needs
      // Sodium and Oculus needs Embeddium; neither starts without it.
      dependencies: await requiredDependencyNames(newest, installed),
      // Position among the options that *survived*, not among the candidates.
      // Keyed to the candidate index it would mark the only option on NeoForge
      // 1.20.1 as not recommended, because Iris — first in the list — has no
      // build there and never reaches this array.
      recommended: options.length === 0,
    });
  }

  // Every candidate exists but none has a build for this pair — a real answer,
  // not a failure: Iris simply has no 1.16.5 Fabric release.
  if (options.length === 0) return { status: 'no-build', mcVersion, modLoader };
  return { status: 'choose', options };
}

/** Install one chosen shader loader, and whatever it cannot run without. */
export async function installShaderLoader(
  profileId: string,
  projectId: string,
  mcVersion: string,
  modLoader: ModLoaderType,
): Promise<ShaderLoaderResult> {
  const candidate = shaderLoaderCandidates(modLoader).find((c) => c.id === projectId);
  if (!candidate) {
    return { status: 'failed', error: `${projectId} is not a shader loader for ${modLoader}` };
  }

  const newest = (await getModVersions(candidate.id, mcVersion, modLoader))[0];
  if (!newest) return { status: 'no-build', mcVersion, modLoader };

  log.info(`Installing shader loader ${candidate.name} for profile ${profileId}`);
  await installModrinthVersion(profileId, candidate.id, candidate.name, newest);
  const dependencies = await installRequiredDependencies(profileId, mcVersion, modLoader, newest);

  return { status: 'installed', name: candidate.name, dependencies };
}

/** The required dependencies a version would pull in that are not already there. */
async function requiredDependencyNames(
  version: ModrinthVersion,
  installed: Array<{ id: string }>,
): Promise<string[]> {
  const names: string[] = [];
  for (const dep of requiredDependencies(version, installed)) {
    names.push(await getProjectTitle(dep.project_id));
  }
  return names;
}

function requiredDependencies(
  version: ModrinthVersion,
  installed: Array<{ id: string }>,
): Array<{ project_id: string; version_id: string | null }> {
  return version.dependencies
    .filter((d) => d.dependency_type === 'required' && d.project_id)
    .filter((d) => !installed.some((m) => m.id === d.project_id))
    .map((d) => ({ project_id: d.project_id as string, version_id: d.version_id }));
}

/**
 * Install a version's required dependencies.
 *
 * One level deep on purpose. Iris and Oculus have a single flat requirement
 * each, and a general resolver would be a graph walk built for a case that does
 * not exist. Returns the names it added, so the UI can say what arrived unasked.
 */
async function installRequiredDependencies(
  profileId: string,
  mcVersion: string,
  modLoader: ModLoaderType,
  version: ModrinthVersion,
): Promise<string[]> {
  const installed = await getInstalledMods(profileId);
  const added: string[] = [];

  for (const dep of requiredDependencies(version, installed)) {
    // A pinned `version_id` is the publisher saying *this* build; honour it.
    // Without one, the newest build for this profile is the right guess.
    const versions = await getModVersions(dep.project_id, mcVersion, modLoader);
    const match = dep.version_id
      ? (versions.find((v) => v.id === dep.version_id) ?? versions[0])
      : versions[0];
    if (!match) {
      log.warn(`Shader loader dependency ${dep.project_id} has no build for ${mcVersion}`);
      continue;
    }

    // The project's title, not the version's — `ModrinthVersion.name` is a
    // build label like "[1.21.4] Sodium 0.6.5", which reads badly in a sentence.
    const name = await getProjectTitle(dep.project_id);
    await installModrinthVersion(profileId, dep.project_id, name, match);
    added.push(name);
  }

  return added;
}
