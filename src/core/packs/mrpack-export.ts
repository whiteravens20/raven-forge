import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from '../../main/logger';
import { paths } from '../config/paths';
import { getProfile, resolveGameDir } from '../profiles/profile-manager';
import { getLoaderVersions } from '../modloader/loader-manager';
import { hashFile } from '../mods/integrity';
import { readLockFile } from '../mods/lock-file';
import { listContent } from '../mods/content-manager';
import { versionsByHash, primaryFile, type ModrinthVersion } from '../mods/modrinth-api';
import { ZipWriter } from './zip-writer';
import type { InstalledMod, ModLoaderType, MrpackExport } from '../../shared/ipc-types';

/**
 * Writing a profile out as a Modrinth modpack.
 *
 * The launcher could read `.mrpack` from four different routes and write none,
 * so what a player built here could not leave here: no way to hand a profile to
 * a friend, and no backup in a format anything else understands. `profiles:export`
 * wrote the profile's own JSON — its Minecraft version and its RAM setting — and
 * not one word about which mods were in it.
 *
 * A `.mrpack` is references, not jars. Every file the launcher can name a
 * Modrinth download for becomes a line in the index, which is why a 400 MB
 * profile leaves as a 20 KB file. Anything Modrinth does not recognise — a
 * private build, a jar compiled locally — is carried in `overrides/` as actual
 * bytes, because the alternative is a pack that silently arrives incomplete.
 */

/** Loader names as the pack format spells them; the inverse of `LOADER_KEYS`. */
const LOADER_DEPENDENCY: Partial<Record<ModLoaderType, string>> = {
  fabric: 'fabric-loader',
  quilt: 'quilt-loader',
  forge: 'forge',
  neoforge: 'neoforge',
};

/** Anything in `config/` past this is a cache or a database, not configuration. */
const MAX_CONFIG_FILE_BYTES = 16 * 1024 * 1024;

/** A ceiling on the whole export, so a mistake produces an error and not a full disk. */
const MAX_PACK_BYTES = 1024 * 1024 * 1024;

/** Where each kind of content lives, in the profile and in the pack. */
const KINDS = [
  { kind: 'mods' as const, dir: paths.profileModsDir, packDir: 'mods', clientOnly: false },
  {
    kind: 'shaders' as const,
    dir: paths.profileShadersDir,
    packDir: 'shaderpacks',
    clientOnly: true,
  },
  {
    kind: 'resourcepacks' as const,
    dir: paths.profileResourcePacksDir,
    packDir: 'resourcepacks',
    clientOnly: true,
  },
];

/** One installed file, with everything the export needs to place it. */
interface Candidate {
  item: InstalledMod;
  /** Absolute path on this machine. */
  source: string;
  /** Directory inside the pack: `mods`, `shaderpacks`, `resourcepacks`. */
  packDir: string;
  /** A server has no use for a shader or a resource pack, and should not fetch one. */
  clientOnly: boolean;
}

/**
 * Everything the profile has installed and switched on.
 *
 * Disabled entries are left out on purpose. A pack is what someone else is
 * meant to play; a mod the author turned off is not part of it, and shipping it
 * as an inert `.jar.disabled` only makes the download bigger.
 */
async function collect(profileId: string): Promise<{ items: Candidate[]; disabled: number }> {
  const items: Candidate[] = [];
  let disabled = 0;

  for (const { kind, dir, packDir, clientOnly } of KINDS) {
    const installed =
      kind === 'mods' ? await readLockFile(profileId) : await listContent(kind, profileId);
    for (const item of installed) {
      if (!item.enabled) {
        disabled++;
        continue;
      }
      items.push({ item, source: path.join(dir(profileId), item.fileName), packDir, clientOnly });
    }
  }

  return { items, disabled };
}

/**
 * Ask Modrinth which of these files it can serve, keyed by candidate index.
 *
 * A failure here is not a failure of the export: with no answer at all every
 * file is bundled instead, which is a much larger pack that still installs. An
 * export that refused to run because Modrinth was down would be strictly worse
 * than one that got big.
 */
async function resolveDownloads(items: Candidate[]): Promise<Map<number, ModrinthVersion>> {
  const hashes = new Map<string, number[]>();
  for (const [index, candidate] of items.entries()) {
    try {
      const hash = await hashFile(candidate.source, 'sha512');
      // Two profiles' worth of the same jar hash alike, and both want the entry.
      hashes.set(hash, [...(hashes.get(hash) ?? []), index]);
    } catch {
      log.warn(`Skipping ${candidate.item.name} in the export: ${candidate.source} is missing`);
    }
  }

  const resolved = new Map<number, ModrinthVersion>();
  try {
    const found = await versionsByHash([...hashes.keys()]);
    for (const [hash, version] of found) {
      for (const index of hashes.get(hash) ?? []) resolved.set(index, version);
    }
  } catch (err) {
    log.warn(`Could not reach Modrinth while exporting; bundling every file instead: ${err}`);
  }

  return resolved;
}

/** Files under `config/`, plus `options.txt`, relative to the game directory. */
async function configOverrides(gameDir: string): Promise<string[]> {
  const found: string[] = [];

  const walk = async (relative: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(path.join(gameDir, relative), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = path.posix.join(relative, entry.name);
      // Directories only; a symlink in `config/` points at something outside the
      // profile as often as not, and following one would put a stranger's file
      // in a pack meant to be shared.
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) found.push(child);
    }
  };

  await walk('config');

  try {
    if ((await fs.stat(path.join(gameDir, 'options.txt'))).isFile()) found.push('options.txt');
  } catch {
    /* a profile that has never been launched has none */
  }

  return found;
}

/**
 * Write the profile out as a `.mrpack` at `destPath`.
 *
 * The file is written whole or not at all: a failure part-way removes what was
 * written rather than leaving a truncated archive that looks like a pack until
 * somebody tries to open it.
 */
export async function exportProfileAsMrpack(
  profileId: string,
  destPath: string,
): Promise<MrpackExport> {
  const profile = await getProfile(profileId);
  if (!profile) throw new Error(`Profile ${profileId} not found`);

  // The format states the loader as a dependency with a version, and there is no
  // way to spell "whatever is newest". A profile that never pinned one has it
  // looked up now, so the pack names a build that exists.
  const dependencies: Record<string, string> = { minecraft: profile.minecraftVersion };
  const loaderKey = LOADER_DEPENDENCY[profile.modLoader];
  if (loaderKey) {
    const version =
      profile.modLoaderVersion ??
      (await getLoaderVersions(profile.modLoader, profile.minecraftVersion).catch(() => [])).find(
        (v) => v.stable,
      )?.version;
    if (!version) {
      throw new Error(
        `This profile does not pin a ${profile.modLoader} version, and no build could be looked ` +
          'up for it. Choose one in the profile editor and export again.',
      );
    }
    dependencies[loaderKey] = version;
  }

  const { items, disabled } = await collect(profileId);
  const resolved = await resolveDownloads(items);

  const files = [];
  const bundle: Candidate[] = [];
  let bundledBytes = 0;

  for (const [index, candidate] of items.entries()) {
    const version = resolved.get(index);
    if (!version) {
      // Nothing to point at, so the bytes travel with the pack. A file that has
      // gone missing from disk was already dropped during resolution and would
      // fail here, so its absence is checked rather than assumed.
      try {
        bundledBytes += (await fs.stat(candidate.source)).size;
        bundle.push(candidate);
      } catch {
        /* already logged while hashing */
      }
      continue;
    }

    const file = primaryFile(version);
    files.push({
      path: `${candidate.packDir}/${file.filename}`,
      hashes: { sha1: file.hashes.sha1, sha512: file.hashes.sha512 },
      ...(candidate.clientOnly
        ? { env: { client: 'required' as const, server: 'unsupported' as const } }
        : {}),
      downloads: [file.url],
      fileSize: file.size,
    });
  }

  const gameDir = resolveGameDir(profile);
  const overrides = await configOverrides(gameDir);

  const index = {
    formatVersion: 1,
    game: 'minecraft',
    // The format wants a version string and a profile has no version number.
    // The date it left is the one fact about this pack that is actually true.
    versionId: new Date().toISOString().slice(0, 10),
    name: profile.name,
    ...(profile.notes ? { summary: profile.notes.split('\n')[0].slice(0, 200) } : {}),
    files,
    dependencies,
  };

  if (bundledBytes > MAX_PACK_BYTES) {
    throw new Error(
      `This profile would bundle ${Math.round(bundledBytes / 1024 / 1024)} MB of files Modrinth ` +
        'does not host, which is too large for a pack. Remove what was installed by hand and try again.',
    );
  }

  const zip = await ZipWriter.create(destPath);
  let written = 0;
  try {
    await zip.addBuffer(
      'modrinth.index.json',
      Buffer.from(JSON.stringify(index, null, 2), 'utf-8'),
    );

    for (const candidate of bundle) {
      await zip.addFile(
        `overrides/${candidate.packDir}/${candidate.item.fileName}`,
        candidate.source,
      );
    }

    for (const relative of overrides) {
      const source = path.join(gameDir, relative);
      // A mod that keeps a database under `config/` should not turn a 20 KB pack
      // into a 300 MB one. Configuration is text and is never this big.
      if ((await fs.stat(source)).size > MAX_CONFIG_FILE_BYTES) {
        log.warn(`Leaving ${relative} out of the pack: too large to be configuration`);
        continue;
      }
      await zip.addFile(`overrides/${relative}`, source);
      written++;
    }

    await zip.finish();
  } catch (err) {
    await zip.abort();
    await fs.rm(destPath, { force: true });
    throw err;
  }

  log.info(
    `Exported profile ${profile.name} to ${destPath}: ${files.length} downloads, ` +
      `${bundle.length} bundled, ${written} overrides`,
  );

  return {
    path: destPath,
    files: files.length,
    bundled: bundle.length,
    bundledBytes,
    overrides: written,
    skippedDisabled: disabled,
  };
}
