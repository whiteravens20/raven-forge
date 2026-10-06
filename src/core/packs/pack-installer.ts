// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { log } from '../../main/logger';
import { paths } from '../config/paths';
import { downloadToFile } from '../net/download';
import { assertSecureAnswer, readJsonCapped } from '../net/json';
import { createProfile, deleteProfile } from '../profiles/profile-manager';
import { syncManifest } from '../mods/mod-sync';
import { mutateLockFile } from '../mods/lock-file';
import { getModVersions, primaryFile } from '../mods/modrinth-api';
import { loaderLabel } from '../../shared/labels';
import { readMrpack, applyOverrides, type MrpackContents, type MrpackFile } from './mrpack';
import { assertSecureContentUrl } from '../../shared/validators';
import { formatRamGb, recommendedRamMb, safeMaxRamMb } from '../../shared/memory';
import { machineMemoryMb } from '../util/machine-memory';
import type { ModManifest } from '../../shared/manifest-schema';
import type { InstalledMod, PackInstall, Profile } from '../../shared/ipc-types';

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

/**
 * The ceiling on a pack file fetched from a URL the launcher does not control,
 * so that a hostile or mistaken response is refused before it fills the disk.
 *
 * A `.mrpack` is mostly references, but not only: what Modrinth does not host
 * travels inside it, and real packs run to hundreds of megabytes that way —
 * Prominence II is 405 MB. The 256 MB this used to be refused five of the
 * hundred most downloaded packs on Modrinth. It is received to disk and read
 * from there, so the size costs no memory.
 */
const MAX_PACK_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;

/** Where a file inside a pack lands decides which part of a manifest it becomes. */
const MODS_DIR = 'mods/';
const RESOURCE_PACKS_DIR = 'resourcepacks/';
const SHADER_PACKS_DIR = 'shaderpacks/';

/** `https://cdn.modrinth.com/data/<project>/versions/<version>/<file>` */
const MODRINTH_CDN = /^https:\/\/cdn\.modrinth\.com\/data\/([^/]+)\/versions\//;

/** A stable id for a pack file, since an `.mrpack` gives its files no ids. */
function entryId(file: MrpackFile): string {
  // A Modrinth download names its project in the path, and that is the same id
  // the mod search speaks — carrying it through is what lets the browse list
  // know the profile already has this mod, instead of offering it a second time
  // under a different filename.
  const project = MODRINTH_CDN.exec(file.downloads[0] ?? '')?.[1];
  if (project) return project;

  // Otherwise the sha512 is the one thing guaranteed present and unique per
  // file. Using the path instead would make a version bump — which changes the
  // filename — look like a different mod, and the old jar would never be
  // cleaned up.
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
 * Both hashes the format publishes are carried across. sha512 is what Modrinth
 * supplies for every file and is what actually gets checked; sha1 comes along
 * because it costs nothing and is the only thing left to verify against for a
 * pack that, unusually, omits the sha512.
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
    const { sha1, sha512 } = file.hashes;
    const shared = { id: entryId(file), name: entryName(file), url, sha512, sha1 };

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
      manifest.configFiles.push({ path: file.path, url, sha512, sha1 });
    }
  }

  return manifest;
}

/**
 * The pack's RAM recommendation, if it made one worth acting on, brought down
 * to what this machine can actually spare.
 *
 * Read here from the manifest as fetched, before the schema has run, so it is
 * attacker-controlled and gets bounds of its own — it lands on a `-Xmx` line,
 * and a pack that asks for 2 TB should leave the profile on the default rather
 * than produce a JVM that cannot start. The upper bound is the machine's, not a
 * constant: a pack built around a 32 GB desktop recommending 16 GB is being
 * helpful, and installing it on an 8 GB laptop should not write a number that
 * machine cannot honour. Clamped rather than warned about because nobody typed
 * it — the log says what happened, and the profile editor shows the result.
 */
function recommendedRam(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
  if (value < 512 || value > 65536) return undefined;
  const ceiling = safeMaxRamMb(machineMemoryMb());
  if (value <= ceiling) return value;
  log.info(
    `Pack recommends ${formatRamGb(value)} of RAM; this machine can spare ` +
      `${formatRamGb(ceiling)} — using that instead`,
  );
  return ceiling;
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
    ...extras,
    // After the spread, not before: a caller that has no recommendation passes
    // the key as undefined, and spreading that over a default erases it.
    allocatedRamMb: extras.allocatedRamMb ?? recommendedRamMb(machineMemoryMb()),
  } as Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>);
}

/**
 * Fill a profile that was just made for a pack, and say how that went.
 *
 * Said, not thrown. The profile is created first and filled second,
 * deliberately: a download that fails halfway leaves a profile the player can
 * see, sync again, or delete — rather than a directory of orphaned jars
 * belonging to nothing. That only holds if the caller is handed the profile
 * when the filling fails, and a rejection carries nothing but its message; this
 * used to throw, so the half-filled profile was one nobody had been told about.
 *
 * `supplied` is the pack itself, for an import. The sync keeps it, which is
 * what a later sync of a profile with no address to ask finishes the job from.
 */
async function firstSync(profile: Profile, supplied?: ModManifest): Promise<PackInstall> {
  try {
    await syncManifest(profile.id, supplied);
    return { profile };
  } catch (err) {
    const failure = err instanceof Error ? err.message : String(err);
    log.warn(`Created ${profile.name}, but its files did not all arrive: ${failure}`);
    return { profile, failure };
  }
}

/**
 * The mods a pack ships as files inside itself rather than as links.
 *
 * They are unpacked with the rest of `overrides/`, and until they were also
 * written down here they were jars the launcher did not know it had: not on the
 * mods page, so not something to switch off or remove, and left out when the
 * profile was exported again. A file the pack's index also names is the index's
 * — that copy is the one the sync writes and keeps.
 */
function bundledMods(pack: MrpackContents): InstalledMod[] {
  const indexed = new Set(pack.files.map((file) => file.path.toLowerCase()));
  return pack.overrides.flatMap((override) => {
    const fileName = /^mods\/([^/]+\.jar)$/i.exec(override.path)?.[1];
    if (!fileName || indexed.has(override.path.toLowerCase())) return [];
    return [
      {
        id: `bundled-${fileName}`,
        name: fileName.replace(/\.jar$/i, ''),
        version: pack.version,
        source: 'local' as const,
        fileName,
        required: false,
        side: 'client' as const,
        enabled: true,
        fromManifest: false,
      },
    ];
  });
}

/** Import a `.mrpack` as a new profile. */
export async function importMrpack(
  filePath: string,
  extras: Pick<Profile, 'iconUrl'> = {},
): Promise<PackInstall> {
  const pack = await readMrpack(filePath);
  log.info(`Importing pack ${pack.name} ${pack.version} (${pack.files.length} files)`);

  const profile = await profileForPack(pack.name, pack.minecraftVersion, pack.modLoader, {
    modLoaderVersion: pack.modLoaderVersion,
    notes: pack.summary,
    ...extras,
  });

  // Overrides go down before the sync, so a config the pack ships is in place
  // the first time the game reads it — and so a manifest-supplied file of the
  // same path wins, which is the order the format intends.
  try {
    const written = await applyOverrides(
      paths.profileGameDir(profile.id),
      filePath,
      pack.overrides,
    );
    if (written > 0) log.info(`Applied ${written} override file(s) for ${pack.name}`);
    const bundled = bundledMods(pack);
    if (bundled.length > 0) await mutateLockFile(profile.id, (mods) => void mods.push(...bundled));
  } catch (err) {
    // The one failure after the profile exists that cannot be picked up again:
    // the pack is only kept once the sync below has it, so a profile left here
    // would have nothing to finish its install from.
    await deleteProfile(profile.id);
    throw err;
  }

  return firstSync(profile, mrpackToManifest(pack));
}

/**
 * Install a modpack found by searching Modrinth, as a new profile.
 *
 * The newest version of the project that fits what was asked for — a Minecraft
 * version, a loader, both or neither — and the pack file of that version. From
 * there it is an ordinary `.mrpack` import: the file is a list of mods with
 * hashes, and the same sync that installs any other pack installs this one.
 *
 * The pack file is checked against the hash Modrinth publishes for it before it
 * is opened. It decides what gets downloaded and where it is written, so it is
 * held to the same standard as the jars it names.
 */
export async function installModrinthPack(
  pack: { id: string; name: string; iconUrl?: string },
  wanted: { gameVersion?: string; loader?: string } = {},
): Promise<PackInstall> {
  const versions = await getModVersions(pack.id, wanted.gameVersion, wanted.loader);
  const version = versions[0];
  if (!version) {
    const fit = [
      wanted.gameVersion && `Minecraft ${wanted.gameVersion}`,
      wanted.loader && loaderLabel(wanted.loader),
    ].filter(Boolean);
    throw new Error(
      `${pack.name} has no version${fit.length > 0 ? ` for ${fit.join(' with ')}` : ''}`,
    );
  }

  const file = primaryFile(version);
  log.info(`Installing Modrinth pack ${pack.name} ${version.version_number} (${file.filename})`);

  const scratch = path.join(paths.cacheDir, `pack-${crypto.randomUUID()}`);
  try {
    await downloadToFile(file.url, scratch, {
      maxBytes: MAX_PACK_DOWNLOAD_BYTES,
      secure: true,
      verify: { hashes: { sha512: file.hashes.sha512 }, label: file.filename },
    });
    // The project's own icon, so the profile is recognisable in the list. Only
    // an https address: the renderer's policy would not load anything else.
    return await importMrpack(scratch, {
      iconUrl: pack.iconUrl?.startsWith('https://') ? pack.iconUrl : undefined,
    });
  } finally {
    await fs.rm(scratch, { force: true });
  }
}

/** A local zip starts with these four bytes; JSON never does. */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/**
 * Create a profile from a link, whichever of the two kinds it turns out to be.
 *
 * Modrinth hands out `.mrpack` links — the "Download" button on a modpack page
 * is one — and a Raven Forge manifest is also just a URL, so the field takes
 * either rather than making the player know which they were given. Deciding by
 * the file extension would be the obvious way and the wrong one: Modrinth's CDN
 * ends its URLs in `.mrpack` but a signed or proxied link need not, and it is
 * the bytes that decide what a thing is.
 *
 * That is why this downloads first and sniffs after. A manifest is a few
 * kilobytes and most pack files are little more, so the cost of being right is
 * as a rule one short download.
 */
export async function createProfileFromUrl(url: string): Promise<PackInstall> {
  assertSecureContentUrl(url);

  const scratch = path.join(paths.cacheDir, `pack-${crypto.randomUUID()}`);
  try {
    await downloadToFile(url, scratch, { maxBytes: MAX_PACK_DOWNLOAD_BYTES, secure: true });

    const head = Buffer.alloc(ZIP_MAGIC.length);
    const handle = await fs.open(scratch, 'r');
    try {
      await handle.read(head, 0, head.length, 0);
    } finally {
      await handle.close();
    }

    // A manifest is refetched by `createProfileFromManifest` rather than read
    // from here. It is a few kilobytes, and the alternative is a second way of
    // building a profile from a manifest that has to stay in step with the
    // first one.
    return head.equals(ZIP_MAGIC)
      ? await importMrpack(scratch)
      : await createProfileFromManifest(url);
  } finally {
    await fs.rm(scratch, { force: true });
  }
}

/**
 * Create a profile that follows a manifest URL.
 *
 * The URL is stored on the profile, so this profile keeps updating: every later
 * sync re-reads it and reconciles. That is the difference between this and an
 * `.mrpack` import, which is a snapshot of a pack at one version.
 */
export async function createProfileFromManifest(url: string): Promise<PackInstall> {
  assertSecureContentUrl(url);

  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Could not fetch the manifest: ${res.status} ${res.statusText}`);
  assertSecureAnswer(res);

  // Read enough to name the profile and pin its Minecraft version. The sync
  // fetches and validates it properly a moment later; this is only so the
  // profile is not created blind and then corrected.
  //
  // A page that is not JSON at all is the ordinary way to get this wrong — a
  // repository page pasted instead of the raw file — and it must read as "wrong
  // address", not as the parser's complaint about a `<` it did not expect.
  let body: Partial<ModManifest> | null;
  try {
    body = (await readJsonCapped(res, 'The manifest')) as Partial<ModManifest> | null;
  } catch {
    throw new Error('That URL does not look like a Raven Forge manifest');
  }
  if (!body?.serverName || !body.minecraftVersion || !body.modLoader) {
    throw new Error('That URL does not look like a Raven Forge manifest');
  }

  const profile = await profileForPack(body.serverName, body.minecraftVersion, body.modLoader, {
    modLoaderVersion: body.modLoaderVersion,
    manifestUrl: url,
    allocatedRamMb: recommendedRam(body.recommendedRamMb),
  });

  return firstSync(profile);
}
