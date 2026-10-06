// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import path from 'node:path';
import { constants as fsConstants } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { log } from '../../main/logger';
import { resolveWithin } from '../util/safe-path';
import { eachEntry, openEntry } from '../util/zip-read';
import type { ModLoaderType } from '../../shared/ipc-types';

/** `O_NOFOLLOW` where the platform has it; 0 elsewhere leaves the flag off. */
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;

/**
 * Reading a Modrinth modpack (`.mrpack`).
 *
 * The format is the only open, cross-launcher modpack standard worth targeting:
 * a zip holding `modrinth.index.json` and an `overrides/` tree, understood by
 * the Modrinth app, Prism, ATLauncher and MultiMC. CurseForge's zip is the other
 * contender and is out — its CDN has required an API key since July 2026, so the
 * files a CurseForge pack points at cannot be fetched at all.
 *
 * An `.mrpack` is references, not jars: the index names each file with its URL,
 * size and hashes, so a 300 MB modpack ships as a 20 KB zip. Which also means
 * everything in here is downloaded from somewhere else, and every one of those
 * somewheres is checked before use.
 */

/** The index is a list of references. One past this is not an index. */
const MAX_INDEX_BYTES = 8 * 1024 * 1024;

/**
 * Ceilings on what a pack's `overrides/` may unpack to.
 *
 * They bound the disk a pack can take, not the memory: an override is written
 * straight from the archive to its place and never held whole. That is what
 * lets them be this high, and they have to be — packs bundle what Modrinth does
 * not host, resource packs and private builds among it, and of the hundred most
 * downloaded ones several run to hundreds of megabytes. The ceilings these
 * replace, 128 MB a file and 512 MB in all, sized for an archive read into
 * memory, turned those away as "larger than any real modpack".
 *
 * What is left is a stop for the zip that unpacks to more than any pack does:
 * twenty kilobytes of deflate can stand for gigabytes.
 */
const MAX_ENTRY_BYTES = 1024 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024;

/** How much a `.mrpack` may unpack to. Overridable so a test can use bytes. */
export interface MrpackLimits {
  maxEntryBytes: number;
  maxTotalBytes: number;
}

const DEFAULT_LIMITS: MrpackLimits = {
  maxEntryBytes: MAX_ENTRY_BYTES,
  maxTotalBytes: MAX_TOTAL_BYTES,
};

/**
 * Loader keys the format uses, mapped to the launcher's own names.
 *
 * The index states loaders as dependency keys beside `minecraft`, so the pack's
 * loader is whichever of these turns up.
 */
const LOADER_KEYS: Record<string, ModLoaderType> = {
  'fabric-loader': 'fabric',
  'quilt-loader': 'quilt',
  forge: 'forge',
  neoforge: 'neoforge',
};

const envSchema = z.enum(['required', 'optional', 'unsupported']);

const mrpackFileSchema = z.object({
  path: z.string().min(1),
  hashes: z.object({ sha1: z.string().optional(), sha512: z.string().optional() }),
  env: z.object({ client: envSchema, server: envSchema }).optional(),
  downloads: z.array(z.string().url()).min(1),
  fileSize: z.number().nonnegative().optional(),
});

const mrpackIndexSchema = z.object({
  formatVersion: z.literal(1),
  game: z.literal('minecraft'),
  versionId: z.string(),
  name: z.string().min(1),
  summary: z.string().optional(),
  files: z.array(mrpackFileSchema),
  dependencies: z.record(z.string(), z.string()),
});

export type MrpackFile = z.infer<typeof mrpackFileSchema>;

/** One file under `overrides/`: where it goes, and where in the archive it is. */
export interface MrpackOverride {
  /** Relative to the game directory, already checked to stay inside it. */
  path: string;
  /** The archive entry the bytes are in. */
  entry: string;
  size: number;
}

/** A pack, read and understood, before anything has been downloaded. */
export interface MrpackContents {
  name: string;
  version: string;
  summary?: string;
  minecraftVersion: string;
  modLoader: ModLoaderType;
  modLoaderVersion?: string;
  /** Files this client needs, `unsupported` ones already dropped. */
  files: MrpackFile[];
  /** What `overrides/` holds. The bytes stay in the archive until {@link applyOverrides}. */
  overrides: MrpackOverride[];
}

/**
 * Reject a zip entry that would write outside the directory it is extracted to.
 *
 * A zip stores whatever path its author put there, including `../../..`, and a
 * modpack is a file downloaded from the internet by definition. Both the
 * `overrides/` tree and the index's own `path` fields go through this — the
 * index is as untrusted as the archive around it.
 */
function safeRelativePath(entry: string): string | null {
  if (entry.includes('\0')) return null;

  // Normalised in posix terms whatever the platform: zip stores forward slashes,
  // a Windows-authored pack may still carry backslashes, and forward slashes are
  // valid on Windows too. Doing it this way keeps one set of rules to check.
  const normalised = path.posix.normalize(entry.replace(/\\/g, '/'));

  // Rejected, never repaired. Stripping the `../` and keeping the rest — which
  // this did — turns an attempt to escape into a silent write somewhere else,
  // so a pack aiming at `../../evil.jar` quietly got `evil.jar` installed. A
  // path that tries to leave is a pack to refuse, not a path to tidy up.
  if (normalised.startsWith('/') || /^[a-zA-Z]:/.test(normalised)) return null;
  // After posix normalisation every interior `..` is resolved, so a surviving
  // one can only be leading — and a leading one leaves the directory.
  if (normalised === '..' || normalised.startsWith('../')) return null;
  if (normalised === '.' || normalised === '') return null;

  return normalised;
}

/** Where an archive entry goes in the game directory, or null when it is not an override. */
function overrideTarget(entryName: string): { relative: string; client: boolean } | null {
  for (const [prefix, client] of [
    ['client-overrides/', true],
    ['overrides/', false],
  ] as const) {
    if (entryName.startsWith(prefix) && entryName.length > prefix.length) {
      return { relative: entryName.slice(prefix.length), client };
    }
  }
  return null;
}

/**
 * The index, and a list of what `overrides/` holds — without unpacking it.
 *
 * Sizes are the ones the archive declares. yauzl holds every entry to its
 * declared size as it is read, so a file that says 1 KB and unpacks to more is
 * an error when {@link applyOverrides} gets to it, not a surprise on disk.
 */
async function scanPack(
  file: string,
  limits: MrpackLimits,
): Promise<{ index: Buffer | null; overrides: MrpackOverride[] }> {
  let index: Buffer | null = null;
  // By destination: a pack may carry a file under both prefixes, and then
  // `client-overrides/` is the one a client takes — that is what it is for.
  const overrides = new Map<string, MrpackOverride & { client: boolean }>();
  let total = 0;

  await eachEntry(file, async (zip, entry) => {
    if (entry.fileName === 'modrinth.index.json') {
      if (entry.uncompressedSize > MAX_INDEX_BYTES) {
        throw new Error('The pack index is implausibly large — refusing to parse it');
      }
      const chunks: Buffer[] = [];
      for await (const chunk of await openEntry(zip, entry)) chunks.push(chunk as Buffer);
      index = Buffer.concat(chunks);
      return;
    }

    const target = overrideTarget(entry.fileName);
    if (!target) return;
    const safe = safeRelativePath(target.relative);
    if (!safe) {
      throw new Error(`The pack tries to write outside the game directory: ${entry.fileName}`);
    }
    if (entry.uncompressedSize > limits.maxEntryBytes) {
      throw new Error(`The pack contains an implausibly large file: ${entry.fileName}`);
    }

    const known = overrides.get(safe);
    if (known && (known.client || !target.client)) return;
    total += entry.uncompressedSize - (known?.size ?? 0);
    if (total > limits.maxTotalBytes) {
      throw new Error('The pack is far larger unpacked than any real modpack — refusing it');
    }
    overrides.set(safe, {
      path: safe,
      entry: entry.fileName,
      size: entry.uncompressedSize,
      client: target.client,
    });
  });

  return {
    index,
    overrides: [...overrides.values()].map(({ path: to, entry, size }) => ({
      path: to,
      entry,
      size,
    })),
  };
}

/** Which loader, and which build of it, a pack's dependencies name. */
function readLoader(dependencies: Record<string, string>): {
  modLoader: ModLoaderType;
  modLoaderVersion?: string;
} {
  for (const [key, loader] of Object.entries(LOADER_KEYS)) {
    if (dependencies[key]) return { modLoader: loader, modLoaderVersion: dependencies[key] };
  }
  // A pack with no loader is a vanilla pack — resource packs and nothing else.
  return { modLoader: 'vanilla' };
}

/**
 * Open a `.mrpack` and work out what installing it would mean.
 *
 * Reads only; nothing is downloaded and nothing is written. Server-only files
 * are dropped here rather than at install time — this is a client launcher, and
 * a file marked `unsupported` for the client has no business being counted in
 * what the player is about to be shown.
 */
export async function readMrpack(
  file: string,
  limits: MrpackLimits = DEFAULT_LIMITS,
): Promise<MrpackContents> {
  const { index: indexRaw, overrides } = await scanPack(file, limits);
  if (!indexRaw) {
    throw new Error('Not a Modrinth pack: modrinth.index.json is missing');
  }

  const parsed = mrpackIndexSchema.safeParse(JSON.parse(indexRaw.toString('utf-8')));
  if (!parsed.success) {
    throw new Error(
      'The pack index is malformed — ' +
        parsed.error.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join('; '),
    );
  }
  const index = parsed.data;

  const minecraftVersion = index.dependencies.minecraft;
  if (!minecraftVersion)
    throw new Error('The pack does not say which Minecraft version it targets');

  const files: MrpackFile[] = [];
  for (const entry of index.files) {
    if (entry.env && entry.env.client === 'unsupported') continue;
    const safe = safeRelativePath(entry.path);
    if (!safe) {
      // Not a warning to bury in a log: a pack trying this is not merely
      // malformed. Refuse the whole thing rather than the one entry.
      throw new Error(`The pack tries to write outside the game directory: ${entry.path}`);
    }
    files.push({ ...entry, path: safe });
  }

  log.info(
    `Read pack ${index.name} ${index.versionId}: ${files.length} files, ${overrides.length} overrides`,
  );

  return {
    name: index.name,
    version: index.versionId,
    summary: index.summary,
    minecraftVersion,
    ...readLoader(index.dependencies),
    files,
    overrides,
  };
}

/**
 * Write a pack's `overrides/` into a profile's game directory, straight from
 * the archive.
 *
 * @param packFile the `.mrpack` that `overrides` was read from
 * @returns how many files were written
 */
export async function applyOverrides(
  gameDir: string,
  packFile: string,
  overrides: MrpackOverride[],
): Promise<number> {
  const wanted = new Map(overrides.map((override) => [override.entry, override]));
  let written = 0;

  await eachEntry(packFile, async (zip, entry) => {
    const override = wanted.get(entry.fileName);
    if (!override) return;

    // Confirms the parent stays inside the game dir even through a symlink; the
    // `O_NOFOLLOW` open below then refuses a symlink sitting where the file
    // itself goes. `fs.writeFile(dest)` followed either, so a link left in the
    // game dir by a previous pack could redirect a write out of the tree.
    const dest = await resolveWithin(gameDir, override.path);
    const handle = await fs.open(
      dest,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | O_NOFOLLOW,
    );
    try {
      await pipeline(await openEntry(zip, entry), handle.createWriteStream());
    } catch (err) {
      // Half an override is worse than none: it would be read as the file.
      await fs.rm(dest, { force: true });
      throw err;
    } finally {
      await handle.close().catch(() => undefined);
    }
    written++;
  });

  return written;
}
