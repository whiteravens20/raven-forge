import fs from 'node:fs/promises';
import path from 'node:path';
import { constants as fsConstants } from 'node:fs';
import yauzl from 'yauzl';
import { z } from 'zod';
import { log } from '../../main/logger';
import { resolveWithin } from '../util/safe-path';
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

/** Nothing in this format is large. A pack index past this is not one. */
const MAX_INDEX_BYTES = 8 * 1024 * 1024;

/**
 * Ceilings on what a `.mrpack` may decompress to, held in memory as it is read.
 *
 * The archive is references, not jars — an override is a config file, a script,
 * at most a small bundled resource pack — so these are anti-bomb ceilings, not
 * a quota any real pack approaches. Without them a 20 KB zip whose entries
 * inflate to gigabytes (a classic deflate bomb) is read whole into the map
 * below and takes the main process down with it. The per-entry cap stops one
 * enormous file; the total stops a thousand merely large ones.
 */
const MAX_ENTRY_BYTES = 128 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;

/** How much a `.mrpack` may decompress to. Overridable so a test can use bytes. */
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
  /** `overrides/` entries: game-dir-relative path → bytes. */
  overrides: Map<string, Buffer>;
  totalBytes: number;
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

/** Read every entry of a zip into memory, keyed by name, under a size ceiling. */
async function readZipEntries(file: string, limits: MrpackLimits): Promise<Map<string, Buffer>> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (err, opened) => {
      if (err || !opened) reject(err ?? new Error(`Could not open ${file}`));
      else resolve(opened);
    });
  });

  const entries = new Map<string, Buffer>();
  let total = 0;
  await new Promise<void>((resolve, reject) => {
    // Once a cap is hit the read is over: stop the loop, close the archive so it
    // is not left reading gigabytes into a promise that already rejected, and
    // let the first failure be the one reported.
    let bailed = false;
    const fail = (err: Error) => {
      if (bailed) return;
      bailed = true;
      zip.close();
      reject(err);
    };

    zip.on('entry', (entry: yauzl.Entry) => {
      if (bailed) return;
      if (entry.fileName.endsWith('/')) {
        zip.readEntry();
        return;
      }
      // The zip's own table declares the inflated size. It can lie, so it is not
      // trusted alone — but a declared size over the cap is refused before a byte
      // is read, and the running count below catches an entry that under-declares.
      if (entry.uncompressedSize > limits.maxEntryBytes) {
        fail(new Error(`The pack contains an implausibly large file: ${entry.fileName}`));
        return;
      }
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) {
          fail(err ?? new Error(`Could not read ${entry.fileName}`));
          return;
        }
        const chunks: Buffer[] = [];
        let entryBytes = 0;
        stream.on('data', (chunk: Buffer) => {
          entryBytes += chunk.length;
          total += chunk.length;
          if (entryBytes > limits.maxEntryBytes || total > limits.maxTotalBytes) {
            stream.destroy();
            fail(
              new Error('The pack is far larger decompressed than any real modpack — refusing it'),
            );
            return;
          }
          chunks.push(chunk);
        });
        stream.on('error', fail);
        stream.on('end', () => {
          if (bailed) return;
          entries.set(entry.fileName, Buffer.concat(chunks));
          zip.readEntry();
        });
      });
    });
    zip.on('end', () => {
      if (!bailed) resolve();
    });
    zip.on('error', fail);
    zip.readEntry();
  });

  return entries;
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
  const entries = await readZipEntries(file, limits);

  const indexRaw = entries.get('modrinth.index.json');
  if (!indexRaw) {
    throw new Error('Not a Modrinth pack: modrinth.index.json is missing');
  }
  if (indexRaw.length > MAX_INDEX_BYTES) {
    throw new Error('The pack index is implausibly large — refusing to parse it');
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

  const overrides = new Map<string, Buffer>();
  for (const [name, data] of entries) {
    // `client-overrides/` wins over `overrides/` where a pack ships both — that
    // is what the prefix is for.
    const relative = name.startsWith('client-overrides/')
      ? name.slice('client-overrides/'.length)
      : name.startsWith('overrides/')
        ? name.slice('overrides/'.length)
        : null;
    if (relative === null || relative === '') continue;

    const safe = safeRelativePath(relative);
    if (!safe) throw new Error(`The pack tries to write outside the game directory: ${name}`);
    if (name.startsWith('client-overrides/') || !overrides.has(safe)) overrides.set(safe, data);
  }

  log.info(
    `Read pack ${index.name} ${index.versionId}: ${files.length} files, ${overrides.size} overrides`,
  );

  return {
    name: index.name,
    version: index.versionId,
    summary: index.summary,
    minecraftVersion,
    ...readLoader(index.dependencies),
    files,
    overrides,
    totalBytes: files.reduce((sum, f) => sum + (f.fileSize ?? 0), 0),
  };
}

/** Write a pack's `overrides/` into a profile's game directory. */
export async function applyOverrides(
  gameDir: string,
  overrides: Map<string, Buffer>,
): Promise<number> {
  for (const [relative, data] of overrides) {
    // Confirms the parent stays inside the game dir even through a symlink; the
    // `O_NOFOLLOW` open below then refuses a symlink sitting where the file
    // itself goes. `fs.writeFile(dest)` followed either, so a link left in the
    // game dir by a previous pack could redirect a write out of the tree.
    const dest = await resolveWithin(gameDir, relative);
    const handle = await fs.open(
      dest,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | O_NOFOLLOW,
    );
    try {
      await handle.writeFile(data);
    } finally {
      await handle.close();
    }
  }
  return overrides.size;
}
