// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { log } from '../../main/logger';
import { CancelledError, isCancellation, throwIfCancelled } from '../util/cancellation';
import { RefusedError } from '../util/refusal';
import { forEachConcurrently } from '../util/concurrency';
import { serializeByKey } from '../util/serialize';
import { eachEntry, openEntry } from '../util/zip-read';
import { downloadToFile } from '../net/download';
import { MOJANG_LIBRARIES, MOJANG_RESOURCES } from '../../shared/constants';
import { hashFile } from '../mods/integrity';
import { getSettings } from '../config/settings-manager';
import { emitProgress } from '../util/progress';
import { getMojangOsName, rulesAllow } from './launch-args';
import type { AssetIndex, DownloadInfo, Library, VersionMeta } from './types';
import type { ProgressEvent, ProgressMessage } from '../../shared/ipc-types';
import { errorText } from '../util/error-text';

// ── Hash verification ──────────────────────────────────────

/** How the files a launch needs are checked, and whether the check can be called off. */
export interface GameFileOptions {
  signal?: AbortSignal;
  /**
   * Hash every file, instead of taking one of the right size as the right file.
   *
   * Off for an ordinary launch. Nothing reaches its final name here except by a
   * rename after its hash was checked, so a file of the declared size is the
   * file that was verified when it arrived — and reading all of it again came
   * to 400 MB of SHA-1 over four thousand assets on every Play, seconds on a
   * warm disk and far longer on a cold one. What size cannot see is a file that
   * rotted in place, so the launch that follows a crash asks for this.
   */
  thorough?: boolean;
}

/**
 * Is the file already there and right?
 *
 * With no published sha1 or size — which is the case for a library named only
 * by Maven coordinates — this can do no better than "a file exists". That is
 * sound only because `downloadFile` never puts a partial file at this path: it
 * is received beside it and renamed on success, so anything sitting here arrived
 * complete. Before that, a download killed halfway left a truncated jar which
 * this then accepted for good, and the profile went on failing to launch with a
 * corrupt loader library that nothing would replace.
 */
async function fileExistsAndValid(
  filePath: string,
  expectedSha1: ExpectedSha1,
  expectedSize: number | undefined,
  thorough: boolean,
): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    if (expectedSize !== undefined) {
      if (stat.size !== expectedSize) return false;
      if (!thorough) return true;
    }
    const accepted = acceptedSha1(expectedSha1);
    if (accepted.length > 0) return accepted.includes(await hashFile(filePath, 'sha1'));
    return true;
  } catch {
    return false;
  }
}

/**
 * What a file's SHA-1 has to be: one value, or any one of several.
 *
 * Several is how Forge's profiles up to 1.12.2 describe a library — a list of
 * `checksums`, because the same jar was also served packed, and came out of
 * that with different bytes. Either was the library.
 */
type ExpectedSha1 = string | readonly string[] | undefined;

function acceptedSha1(expected: ExpectedSha1): readonly string[] {
  if (expected === undefined) return [];
  return typeof expected === 'string' ? [expected] : expected;
}

// ── Download with retry ────────────────────────────────────

const DOWNLOAD_ATTEMPTS = 3;

/**
 * Fetch one game file, retrying, and never leave a partial one behind.
 *
 * The transfer itself is `downloadToFile`, which is the launcher's one download
 * policy: a stall timeout that resets on every chunk, backpressure by awaiting
 * each write, the body received beside the destination and hashed as it is
 * written, and the destination given its name only once that hash is right.
 * This used to be a second implementation with an absolute
 * `AbortSignal.timeout(60_000)`, and that is the mistake `download.ts` already
 * documents at length — the signal governs the body stream, so the 26 MB client
 * jar was simply unfetchable below about 3.5 Mbit/s, three identical times in a
 * row.
 */
async function downloadFile(
  url: string,
  dest: string,
  sha1: ExpectedSha1,
  signal: AbortSignal | undefined,
): Promise<void> {
  const accepted = acceptedSha1(sha1);
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
    throwIfCancelled(signal, 'Download');
    try {
      if (accepted.length > 1) {
        await downloadAnyOf(url, dest, accepted, signal);
        return;
      }
      // Libraries and natives are loaded straight into the JVM, so the bytes
      // come down https and are held to the published sha1 when there is one.
      await downloadToFile(url, dest, {
        signal,
        secure: true,
        verify:
          accepted.length === 1
            ? { hashes: { sha1: accepted[0] }, label: path.basename(dest) }
            : undefined,
      });
      return;
    } catch (err) {
      // A cancelled job must not be retried — that would keep downloading for
      // another three rounds after the user asked us to stop.
      if (signal?.aborted || isCancellation(err)) throw new CancelledError('Download');
      if (attempt === DOWNLOAD_ATTEMPTS)
        throw new Error(`Failed to download ${url} after ${DOWNLOAD_ATTEMPTS} attempts: ${err}`, {
          cause: err,
        });
      log.warn(`Download attempt ${attempt} failed for ${url}: ${errorText(err)}`);
    }
  }
}

/**
 * Fetch a file that any one of several hashes vouches for.
 *
 * The downloader checks against one hash, so this receives the file under a
 * name of its own and gives it the real one only when it has matched — the same
 * promise as everywhere else here, that nothing sits at its final name
 * unchecked.
 */
async function downloadAnyOf(
  url: string,
  dest: string,
  accepted: readonly string[],
  signal: AbortSignal | undefined,
): Promise<void> {
  const unchecked = `${dest}.unchecked`;
  try {
    await downloadToFile(url, unchecked, { signal, secure: true });
    const actual = await hashFile(unchecked, 'sha1');
    if (!accepted.includes(actual)) {
      throw new Error(
        `sha1 mismatch for ${path.basename(dest)}: expected one of ${accepted.join(', ')}, got ${actual}`,
      );
    }
    await fs.rename(unchecked, dest);
  } catch (err) {
    await fs.rm(unchecked, { force: true });
    throw err;
  }
}

// ── Parallel download helper ───────────────────────────────

interface DownloadTask {
  url: string;
  dest: string;
  sha1?: ExpectedSha1;
  size?: number;
}

/** How often the checking pass is allowed to say where it has got to. */
const CHECK_EMIT_INTERVAL_MS = 100;

/**
 * One task per destination, the first one named.
 *
 * Mojang's lists repeat themselves. A version from 1.13 to 1.18.2 names each
 * LWJGL jar once per rule set, an asset index gives one object to every name
 * that shares its content — 524 of the legacy index's 1,120 entries are a file
 * already listed — and each repeat used to be checked and, when missing,
 * fetched again: twice the requests of a first install, and two downloads
 * taking turns at one file.
 */
function uniqueByDestination(tasks: DownloadTask[]): DownloadTask[] {
  const seen = new Set<string>();
  return tasks.filter((task) => !seen.has(task.dest) && seen.add(task.dest));
}

/**
 * Fetch whatever is missing or wrong, and leave the rest alone.
 *
 * Which files are already correct is decided **once**. This used to ask twice
 * per task — a serial pass to seed the progress counter, then again inside each
 * worker — so a launch with the game fully installed did two complete SHA-1
 * passes over roughly four thousand assets plus every library and the client
 * jar, purely to conclude that nothing needed doing. The check itself is also
 * run at the download concurrency now rather than one file at a time.
 *
 * Both passes report, and each says what it is. Checking is the *whole* of a
 * launch with nothing to fetch, and it used to run behind a bar frozen at zero,
 * under the words "Downloading game assets", which was the one thing that was
 * certainly not happening. The same correction the pack sync already got.
 */
async function downloadBatch(
  listed: DownloadTask[],
  concurrency: number,
  opts: GameFileOptions & {
    operationId: string;
    /** Said while the files already on disk are being checked. */
    checkLabel: ProgressMessage;
    /** Said while the ones that failed that check are being fetched. */
    downloadLabel: ProgressMessage;
  },
): Promise<void> {
  const tasks = uniqueByDestination(listed);
  const total = tasks.length;

  const emit = (progress: number, message: ProgressMessage, done: number, installing = false) => {
    emitAssetProgress({
      operationId: opts.operationId,
      progress,
      message,
      filesCompleted: done,
      filesTotal: total,
      installing,
    });
  };

  const { checkLabel, downloadLabel, signal, thorough = false } = opts;

  // ── Pass one: which of these are already here and correct ──

  emit(0, checkLabel, 0);
  let checked = 0;
  let lastCheckEmit = Date.now();

  const pending: DownloadTask[] = [];
  await forEachConcurrently(tasks, concurrency, async (task) => {
    throwIfCancelled(signal, 'Download');
    // Counted on entry rather than on completion, so this pass can never report
    // a full bar: the renderer clears an operation that says it has finished,
    // and the downloads this pass exists to find are still to come.
    //
    // Rate-limited because checking runs at disk speed. Emitting per file would
    // be thousands of IPC messages and renderer updates inside a couple of
    // seconds, for a bar that has a hundred distinct positions. The downloads
    // below space themselves out on the network and need no such limit.
    const now = Date.now();
    if (now - lastCheckEmit >= CHECK_EMIT_INTERVAL_MS) {
      lastCheckEmit = now;
      emit(total > 0 ? checked / total : 0, checkLabel, checked);
    }
    checked++;
    if (!(await fileExistsAndValid(task.dest, task.sha1, task.size, thorough))) pending.push(task);
  });

  // ── Pass two: fetch what pass one turned down ──

  let completed = total - pending.length;
  const reportDownload = () =>
    emit(total > 0 ? completed / total : 1, downloadLabel, completed, true);

  // Announced only when there is something to announce. Seeding the counter
  // unconditionally put the download line on screen — at 100%, on a launch with
  // nothing missing — for the one tick before the completion event replaced it.
  if (pending.length > 0) reportDownload();

  await forEachConcurrently(pending, concurrency, async (task) => {
    await downloadFile(task.url, task.dest, task.sha1, signal);
    completed++;
    reportDownload();
  });

  // Only a batch that actually fetched something says a download finished.
  emit(
    1,
    pending.length > 0
      ? { key: 'progress.msg.downloadComplete' }
      : { key: 'progress.msg.gameFilesReady' },
    total,
  );
}

// ── Download client JAR ────────────────────────────────────

export async function ensureClientJar(
  versionsDir: string,
  versionId: string,
  clientDl: DownloadInfo,
  { signal, thorough = false }: GameFileOptions = {},
): Promise<string> {
  const jarPath = path.join(versionsDir, versionId, `${versionId}.jar`);
  if (await fileExistsAndValid(jarPath, clientDl.sha1, clientDl.size, thorough)) {
    return jarPath;
  }

  log.info(`Downloading client jar for ${versionId}...`);
  await downloadFile(clientDl.url, jarPath, clientDl.sha1, signal);
  return jarPath;
}

// ── Download libraries ─────────────────────────────────────

/** A library with no rules is for everyone; with rules, they decide. */
function shouldIncludeLibrary(lib: Library): boolean {
  return !lib.rules || rulesAllow(lib.rules);
}

function emitAssetProgress(event: ProgressEvent): void {
  emitProgress('progress:game-assets', event);
}

// ── Maven coordinates ──────────────────────────────────────
// Mod loader profiles (Fabric, Quilt) list libraries as bare Maven coordinates
// plus a repository URL, with no `downloads` block. Resolve them the way the
// Maven layout dictates: group/artifact/version/artifact-version[-classifier].ext

interface MavenCoords {
  /** Repo-relative path, e.g. `org/ow2/asm/asm/9.10.1/asm-9.10.1.jar` */
  path: string;
}

export function parseMavenCoords(name: string): MavenCoords | null {
  // group:artifact:version[:classifier][@ext]
  const [coords, extFromAt] = name.split('@');
  const parts = coords.split(':');
  if (parts.length < 3) return null;

  const [group, artifact, version, classifier] = parts;
  const ext = extFromAt ?? 'jar';
  const fileName = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.${ext}`;

  return { path: [...group.split('.'), artifact, version, fileName].join('/') };
}

// ── Native library extraction ──────────────────────────────

const DEFAULT_NATIVE_EXCLUDES = ['META-INF/'];
const NATIVE_EXTENSIONS = ['.so', '.dll', '.dylib', '.jnilib'];

function isNativeBinary(entryName: string): boolean {
  return NATIVE_EXTENSIONS.some((ext) => entryName.toLowerCase().endsWith(ext));
}

/**
 * The classifier a legacy `natives` map names for this machine.
 *
 * The oldest versions write the Windows one as `natives-windows-${arch}` and
 * expect the launcher to say which. Left as written it matched no classifier,
 * and those jars were skipped without a word.
 */
export function nativesClassifier(
  natives: Record<string, string>,
  osName: string = getMojangOsName(),
  arch: string = process.arch,
): string | undefined {
  return natives[osName]?.replace('${arch}', arch === 'ia32' ? '32' : '64');
}

async function hasSize(file: string, size: number): Promise<boolean> {
  try {
    return (await fs.stat(file)).size === size;
  } catch {
    return false;
  }
}

/**
 * Unpack the native binaries out of a jar into `nativesDir`.
 *
 * Up to 1.18.2 Minecraft passes `-Djava.library.path=<nativesDir>` and expects
 * the platform `.so`/`.dll`/`.dylib` files to be sitting there loose. Downloading
 * the native jars is not enough — without this step the game dies on LWJGL init
 * with UnsatisfiedLinkError.
 *
 * The directory is shared by every profile on one Minecraft version, and one of
 * them may be running. So a file that is already there at the right size is left
 * alone, and one that is not is written beside its name and renamed onto it.
 * Writing in place — which this did, for every file, at every launch — truncates
 * a library the other game has mapped: starting a second profile on the same
 * version killed the first with SIGBUS, with identical bytes on their way in.
 */
async function extractNatives(
  jarPath: string,
  nativesDir: string,
  exclude: string[],
): Promise<void> {
  const excludes = [...DEFAULT_NATIVE_EXCLUDES, ...exclude];

  await eachEntry(jarPath, async (zip, entry) => {
    const name = entry.fileName;
    if (excludes.some((p) => name.startsWith(p)) || !isNativeBinary(name)) return;

    // Flatten: java.library.path is not searched recursively.
    const dest = path.join(nativesDir, path.basename(name));
    if (await hasSize(dest, entry.uncompressedSize)) return;

    const part = `${dest}.part`;
    try {
      await pipeline(await openEntry(zip, entry), createWriteStream(part));
      await fs.rename(part, dest);
    } catch (err) {
      await fs.rm(part, { force: true });
      throw err;
    }
  });
}

export async function ensureLibraries(
  librariesDir: string,
  meta: VersionMeta,
  nativesDir?: string,
  options: GameFileOptions = {},
): Promise<string[]> {
  const settings = await getSettings();
  const concurrency = settings.downloadConcurrency;
  const tasks: DownloadTask[] = [];
  const installerMade: DownloadTask[] = [];
  const classpath: string[] = [];
  const nativeJars: Array<{ jarPath: string; exclude: string[] }> = [];

  for (const lib of meta.libraries) {
    if (!shouldIncludeLibrary(lib)) continue;

    if (lib.downloads?.artifact) {
      // From 1.19 the natives are among these too, as ordinary artifacts with a
      // `natives-<os>` classifier. They only go on the classpath: LWJGL, JNA and
      // Netty each unpack their own into the natives directory the version's
      // arguments point them at, so a copy made here was never the one loaded.
      const artifact = lib.downloads.artifact;
      const dest = path.join(librariesDir, artifact.path);
      const task = { url: artifact.url, dest, sha1: artifact.sha1, size: artifact.size };
      // No address means a loader's installer made the file on this machine:
      // there is nothing to fetch, only something to find.
      (artifact.url === '' ? installerMade : tasks).push(task);
      classpath.push(dest);
    } else if (lib.url || !lib.natives) {
      // Maven-style entry from a loader profile: coordinates, and the repository
      // they are in unless that is Mojang's. No hashes are guaranteed — Fabric
      // publishes a sha1 beside the coordinates when it has one, an old Forge
      // profile a list of them, Quilt nothing.
      //
      // An entry with neither `downloads` nor `url` used to be skipped without a
      // word, and the game then started without that library. One that names
      // only natives still is: those are unpacked below, never put on the
      // classpath.
      const coords = parseMavenCoords(lib.name);
      if (coords) {
        const dest = path.join(librariesDir, coords.path);
        const repository = lib.url ?? MOJANG_LIBRARIES;
        const baseUrl = repository.endsWith('/') ? repository : `${repository}/`;
        tasks.push({
          url: `${baseUrl}${coords.path}`,
          dest,
          sha1: lib.sha1 ?? lib.checksums,
          size: lib.size,
        });
        classpath.push(dest);
      }
    }

    // Versions up to 1.18.2 declare a `natives` map pointing into `classifiers`.
    // These are extraction-only — never on the classpath.
    if (lib.natives && lib.downloads?.classifiers) {
      const nativeKey = nativesClassifier(lib.natives);
      const classifier = nativeKey ? lib.downloads.classifiers[nativeKey] : undefined;
      if (classifier) {
        const dest = path.join(librariesDir, classifier.path);
        tasks.push({ url: classifier.url, dest, sha1: classifier.sha1, size: classifier.size });
        nativeJars.push({ jarPath: dest, exclude: lib.extract?.exclude ?? [] });
      }
    }
  }

  // Before anything is fetched: a launch that cannot be started is better
  // refused now than after its downloads. Asked to download one of these, the
  // launcher tried an empty address three times and reported what the
  // downloader says about addresses that are not https.
  const thorough = options.thorough ?? false;
  for (const { dest, sha1, size } of installerMade) {
    if (await fileExistsAndValid(dest, sha1, size, thorough)) continue;
    throw new RefusedError(
      { key: 'launchError.loaderFileMissing', vars: { file: path.basename(dest) } },
      `${dest} is made by the loader's installer and is missing or damaged`,
    );
  }

  log.info(`Ensuring ${tasks.length + installerMade.length} libraries...`);
  await downloadBatch(tasks, concurrency, {
    ...options,
    operationId: `libraries-${meta.id}`,
    checkLabel: { key: 'progress.msg.checkingLibraries', vars: { version: meta.id } },
    downloadLabel: { key: 'progress.msg.libraries', vars: { version: meta.id } },
  });

  if (nativesDir && nativeJars.length > 0) {
    // One at a time per directory: two profiles on one version are got ready at
    // once often enough, and both would be writing the same `.part` names.
    await serializeByKey(`natives:${nativesDir}`, async () => {
      await fs.mkdir(nativesDir, { recursive: true });
      log.info(`Extracting ${nativeJars.length} native libraries to ${nativesDir}...`);
      for (const { jarPath, exclude } of uniqueJars(nativeJars)) {
        try {
          await extractNatives(jarPath, nativesDir, exclude);
        } catch (err) {
          log.warn(`Failed to extract natives from ${path.basename(jarPath)}: ${err}`);
        }
      }
    });
  }

  return classpath;
}

/** A native jar is named once per rule set that includes it; unpack it once. */
function uniqueJars<T extends { jarPath: string }>(jars: T[]): T[] {
  const seen = new Set<string>();
  return jars.filter((jar) => !seen.has(jar.jarPath) && seen.add(jar.jarPath));
}

// ── Download assets ────────────────────────────────────────

/**
 * Where a version expects to find its assets by name, when it does.
 *
 * Everything since 1.7.10 reads `objects/` through the index and wants nothing
 * else. The versions before it cannot: 1.6 to 1.7.2 look in one folder of real
 * file names — the index calls that `virtual` — and everything older reads
 * `resources/` inside its own game directory. Returns null for a modern index.
 */
function namedAssetsDir(
  index: AssetIndex,
  indexId: string,
  assetsDir: string,
  gameDir: string | undefined,
): string | null {
  if (index.map_to_resources && gameDir) return path.join(gameDir, 'resources');
  if (index.virtual || index.map_to_resources) return path.join(assetsDir, 'virtual', indexId);
  return null;
}

/**
 * Lay the objects out under the names the index gives them.
 *
 * Copies, because the game opens them as ordinary files; made once, since a
 * copy that is already there at the right size is left alone. Without this the
 * oldest twenty releases started with every asset downloaded and none of them
 * found: no sounds, no language files, and in the very oldest no icon.
 */
async function materialiseAssets(
  index: AssetIndex,
  objectsDir: string,
  namedDir: string,
): Promise<void> {
  const root = path.resolve(namedDir);
  for (const [name, obj] of Object.entries(index.objects)) {
    const dest = path.resolve(root, name);
    // The names are Mojang's, and are still not allowed to choose a place
    // outside the folder they are being laid out in.
    if (!dest.startsWith(root + path.sep)) {
      throw new Error(`The asset index names a file outside its folder: ${name}`);
    }
    if (await hasSize(dest, obj.size)) continue;
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(path.join(objectsDir, obj.hash.substring(0, 2), obj.hash), dest);
  }
}

/**
 * Make sure every asset the version needs is on disk.
 *
 * @returns the folder to hand the game as `${game_assets}`: the assets root,
 *          or for the versions that read assets by name, the folder of names
 */
export async function ensureAssets(
  assetsDir: string,
  meta: VersionMeta,
  options: GameFileOptions & { gameDir?: string } = {},
): Promise<string> {
  const settings = await getSettings();
  const indexDir = path.join(assetsDir, 'indexes');
  const objectsDir = path.join(assetsDir, 'objects');
  await fs.mkdir(indexDir, { recursive: true });

  const indexFile = path.join(indexDir, `${meta.assetIndex.id}.json`);

  // Download asset index
  // Always by hash: it is one small file, and it decides what every other
  // asset is supposed to be.
  if (!(await fileExistsAndValid(indexFile, meta.assetIndex.sha1, undefined, true))) {
    await downloadFile(meta.assetIndex.url, indexFile, meta.assetIndex.sha1, options.signal);
  }

  const indexRaw = await fs.readFile(indexFile, 'utf-8');
  const assetIndex = JSON.parse(indexRaw) as AssetIndex;

  const tasks: DownloadTask[] = [];
  for (const [name, obj] of Object.entries(assetIndex.objects)) {
    // It becomes a file name and a URL, so it has to be what it says it is.
    if (!/^[0-9a-f]{40}$/.test(obj.hash)) {
      throw new Error(`The asset index gives ${name} a hash that is not one`);
    }
    const prefix = obj.hash.substring(0, 2);
    const dest = path.join(objectsDir, prefix, obj.hash);
    const url = `${MOJANG_RESOURCES}/${prefix}/${obj.hash}`;
    tasks.push({ url, dest, sha1: obj.hash, size: obj.size });
  }

  log.info(`Ensuring ${tasks.length} assets...`);
  await downloadBatch(tasks, settings.downloadConcurrency, {
    ...options,
    operationId: `assets-${meta.id}`,
    checkLabel: { key: 'progress.msg.checkingAssets' },
    downloadLabel: { key: 'progress.msg.assets' },
  });

  const namedDir = namedAssetsDir(assetIndex, meta.assetIndex.id, assetsDir, options.gameDir);
  if (!namedDir) return assetsDir;
  throwIfCancelled(options.signal, 'Download');
  await materialiseAssets(assetIndex, objectsDir, namedDir);
  return namedDir;
}
