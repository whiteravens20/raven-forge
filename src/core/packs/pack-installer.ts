import path from 'node:path';
import { log } from '../../main/logger';
import { paths } from '../config/paths';
import { createProfile } from '../profiles/profile-manager';
import { syncManifest } from '../mods/mod-sync';
import { readMrpack, applyOverrides, type MrpackContents, type MrpackFile } from './mrpack';
import type { ModManifest } from '../../shared/manifest-schema';
import type { Profile } from '../../shared/ipc-types';

/**
 * Turning a pack into a profile.
 *
 * Three ways in, one destination. A `.mrpack` is a list of files with URLs and
 * hashes; a Raven Forge manifest is a list of files with URLs and hashes; a pack
 * from the White Ravens catalogue is a manifest URL. So all three end up
 * reconciled by the same sync path rather than by three installers that drift —
 * which also means each one gets hash verification, cancellation, orphan
 * removal and the resource-pack order written into `options.txt` for free.
 */

/** Where a file inside a pack lands decides which part of a manifest it becomes. */
const MODS_DIR = 'mods/';
const RESOURCE_PACKS_DIR = 'resourcepacks/';
const SHADER_PACKS_DIR = 'shaderpacks/';

/** A stable id for a pack file, since an `.mrpack` gives its files no ids. */
function entryId(file: MrpackFile): string {
  // The sha512 is the one thing guaranteed present and unique per file. Using
  // the path instead would make a version bump — which changes the filename —
  // look like a different mod, and the old jar would never be cleaned up.
  return file.hashes.sha512?.slice(0, 32) ?? file.path;
}

/** A file's display name: its filename, without the extension noise. */
function entryName(file: MrpackFile): string {
  return path.basename(file.path).replace(/\.(jar|zip)$/i, '');
}

/**
 * Express a pack as a manifest.
 *
 * Files are sorted by where the pack puts them, because that is the only signal
 * the format gives: `mods/` becomes mods, `resourcepacks/` and `shaderpacks/`
 * become their own lists so the content page can order and toggle them, and
 * anything else becomes a config file, which is the manifest's term for "a
 * fetched file at an exact path".
 *
 * `sha512` is the hash carried across. The manifest schema knows sha256 and
 * sha512, an `.mrpack` publishes sha1 and sha512, and so sha512 is the pair's
 * only overlap — which is fine, because Modrinth supplies it for every file.
 */
export function mrpackToManifest(pack: MrpackContents): ModManifest {
  const manifest: ModManifest = {
    manifestVersion: 2,
    serverName: pack.name,
    minecraftVersion: pack.minecraftVersion,
    modLoader: pack.modLoader,
    modLoaderVersion: pack.modLoaderVersion,
    mods: [],
    resourcePacks: [],
    shaders: [],
    configFiles: [],
  };

  for (const file of pack.files) {
    const url = file.downloads[0];
    const sha512 = file.hashes.sha512;
    const shared = { id: entryId(file), name: entryName(file), url, sha512 };

    if (file.path.startsWith(MODS_DIR)) {
      manifest.mods.push({
        ...shared,
        version: pack.version,
        source: 'url',
        fileName: path.basename(file.path),
        // `optional` in a pack means the player may turn it off, not that the
        // launcher may skip it — the pack ships it either way.
        required: file.env?.client !== 'optional',
        side: 'client',
      });
    } else if (file.path.startsWith(RESOURCE_PACKS_DIR)) {
      manifest.resourcePacks.push({
        ...shared,
        version: pack.version,
        source: 'url',
        fileName: path.basename(file.path),
      });
    } else if (file.path.startsWith(SHADER_PACKS_DIR)) {
      manifest.shaders.push({
        ...shared,
        version: pack.version,
        source: 'url',
        fileName: path.basename(file.path),
      });
    } else {
      // Everything else keeps its exact path. Packs put real things here —
      // `config/`, datapacks, a `journeymap/` layout — and dropping them would
      // produce a pack that installs and then does not behave like the pack.
      manifest.configFiles.push({ path: file.path, url, sha512 });
    }
  }

  return manifest;
}

/** A profile created for a pack, before its files arrive. */
async function profileForPack(
  name: string,
  minecraftVersion: string,
  modLoader: Profile['modLoader'],
  extras: Partial<Profile> = {},
): Promise<Profile> {
  return createProfile({
    name,
    minecraftVersion,
    modLoader,
    allocatedRamMb: extras.allocatedRamMb ?? 4096,
    ...extras,
  } as Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>);
}

/**
 * Import a `.mrpack` as a new profile.
 *
 * The profile is created first and filled second, deliberately: a download that
 * fails halfway leaves a profile the player can see, retry the sync on, or
 * delete — rather than a directory of orphaned jars belonging to nothing.
 */
export async function importMrpack(filePath: string): Promise<Profile> {
  const pack = await readMrpack(filePath);
  log.info(`Importing pack ${pack.name} ${pack.version} (${pack.files.length} files)`);

  const profile = await profileForPack(pack.name, pack.minecraftVersion, pack.modLoader, {
    modLoaderVersion: pack.modLoaderVersion,
    notes: pack.summary,
  });

  // Overrides go down before the sync, so a config the pack ships is in place
  // the first time the game reads it — and so a manifest-supplied file of the
  // same path wins, which is the order the format intends.
  const written = await applyOverrides(paths.profileGameDir(profile.id), pack.overrides);
  if (written > 0) log.info(`Applied ${written} override file(s) for ${pack.name}`);

  await syncManifest(profile.id, mrpackToManifest(pack));
  return profile;
}

/**
 * Create a profile that follows a manifest URL.
 *
 * The URL is stored on the profile, so this profile keeps updating: every later
 * sync re-reads it and reconciles. That is the difference between this and an
 * `.mrpack` import, which is a snapshot of a pack at one version.
 */
export async function createProfileFromManifest(url: string): Promise<Profile> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('A manifest URL must be http or https');
  }

  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Could not fetch the manifest: ${res.status} ${res.statusText}`);

  // Read enough to name the profile and pin its Minecraft version. The sync
  // fetches and validates it properly a moment later; this is only so the
  // profile is not created blind and then corrected.
  const body = (await res.json()) as Partial<ModManifest>;
  if (!body.serverName || !body.minecraftVersion || !body.modLoader) {
    throw new Error('That URL does not look like a Raven Forge manifest');
  }

  const profile = await profileForPack(body.serverName, body.minecraftVersion, body.modLoader, {
    modLoaderVersion: body.modLoaderVersion,
    manifestUrl: url,
  });

  await syncManifest(profile.id);
  return profile;
}
