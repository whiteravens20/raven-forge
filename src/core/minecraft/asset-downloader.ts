import fs from 'node:fs/promises';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import { log } from '../../main/logger';
import { CancelledError, isCancellation, throwIfCancelled } from '../util/cancellation';
import { downloadToFile } from '../net/download';
import { MOJANG_RESOURCES } from '../../shared/constants';
import { hashFile } from '../mods/integrity';
import { getSettings } from '../config/settings-manager';
import { getMainWindow } from '../../main/window';
import { getMojangOsName } from './launch-args';
import type { AssetIndex, DownloadInfo, Library, VersionMeta } from './types';
import type { ProgressEvent, ProgressMessage } from '../../shared/ipc-types';

// ── Hash verification ──────────────────────────────────────

async function sha1File(filePath: string): Promise<string> {
  return hashFile(filePath, 'sha1');
}

/**
 * Is the file already there and right?
 *
 * With no published sha1 or size — which is the case for a library named only
 * by Maven coordinates — this can do no better than "a file exists". That is
 * sound only because `downloadFile` never puts a partial file at this path: it
 * receives into a `.part` beside it and renames on success, so anything sitting
 * here arrived complete. Before that, a download killed halfway left a truncated
 * jar which this then accepted for good, and the profile went on failing to
 * launch with a corrupt loader library that nothing would replace.
 */
async function fileExistsAndValid(
  filePath: string,
  expectedSha1?: string,
  expectedSize?: number,
): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    if (expectedSize !== undefined && stat.size !== expectedSize) return false;
    if (expectedSha1) {
      const hash = await sha1File(filePath);
      return hash === expectedSha1;
    }
    return true;
  } catch {
    return false;
  }
}

// ── Download with retry ────────────────────────────────────

/**
 * Fetch one game file, retrying, and never leave a partial one behind.
 *
 * The transfer itself is `downloadToFile`, which is the launcher's one download
 * policy: a stall timeout that resets on every chunk, backpressure by awaiting
 * each write, and the destination removed on any failure at all. This used to be
 * a second implementation with an absolute `AbortSignal.timeout(60_000)`, and
 * that is the mistake `download.ts` already documents at length — the signal
 * governs the body stream, so the 26 MB client jar was simply unfetchable below
 * about 3.5 Mbit/s, three identical times in a row.
 *
 * The cleanup matters as much. The old final attempt threw without deleting, so
 * a truncated file stayed on disk; the next launch saw a library with no
 * published sha1 or size, found *a* file there, and called it installed for
 * good.
 */
async function downloadFile(
  url: string,
  dest: string,
  sha1?: string,
  retries = 3,
  signal?: AbortSignal,
): Promise<void> {
  // Received beside the target and renamed onto it, so the destination only ever
  // exists complete. `rename` within a directory is atomic, and a process killed
  // mid-transfer leaves a `.part` that the next run overwrites rather than a
  // short file that `fileExistsAndValid` would accept as installed.
  const part = `${dest}.part`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    throwIfCancelled(signal, 'Download');
    try {
      // Libraries and natives are loaded straight into the JVM, so the bytes
      // come down https; the published sha1 (when there is one) is checked next.
      await downloadToFile(url, part, { signal, secure: true });

      if (sha1) {
        const hash = await sha1File(part);
        if (hash !== sha1) throw new Error(`SHA1 mismatch: expected ${sha1}, got ${hash}`);
      }

      await fs.rename(part, dest);
      return; // success
    } catch (err) {
      // Whatever went wrong, nothing half-written survives this function.
      await fs.rm(part, { force: true });
      // A cancelled job must not be retried — that would keep downloading for
      // another three rounds after the user asked us to stop.
      if (signal?.aborted || isCancellation(err)) throw new CancelledError('Download');
      if (attempt === retries)
        throw new Error(`Failed to download ${url} after ${retries} attempts: ${err}`, {
          cause: err,
        });
      log.warn(`Download attempt ${attempt} failed for ${url}: ${err}`);
    }
  }
}

// ── Parallel download helper ───────────────────────────────

interface DownloadTask {
  url: string;
  dest: string;
  sha1?: string;
  size?: number;
}

/**
 * Run `work` over every item, with at most `concurrency` in flight.
 *
 * The first failure stops the rest. `Promise.all` rejects on it either way, but
 * the other workers went on draining the queue regardless — so a launch that had
 * already failed carried on pulling the remaining few thousand assets in the
 * background, for nobody.
 */
async function forEachConcurrently<T>(
  items: T[],
  concurrency: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  let failed = false;
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.max(1, concurrency); i++) {
    workers.push(
      (async () => {
        while (queue.length > 0 && !failed) {
          try {
            await work(queue.shift()!);
          } catch (err) {
            failed = true;
            throw err;
          }
        }
      })(),
    );
  }
  // `allSettled` first, so every worker has finished before this returns: with
  // `all` the losers stayed in flight past the rejection, writing into a
  // directory the caller believes it is done with.
  const results = await Promise.allSettled(workers);
  const firstRejection = results.find((r) => r.status === 'rejected');
  if (firstRejection) throw (firstRejection as PromiseRejectedResult).reason;
}

/** How often the checking pass is allowed to say where it has got to. */
const CHECK_EMIT_INTERVAL_MS = 100;

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
 * launch with nothing to fetch — several seconds of SHA-1 over every asset —
 * and it used to run behind a bar frozen at zero, under the words "Downloading
 * game assets", which was the one thing that was certainly not happening. The
 * same correction the pack sync already got.
 */
async function downloadBatch(
  tasks: DownloadTask[],
  concurrency: number,
  opts?: {
    operationId: string;
    /** Said while the files already on disk are being checked. */
    checkLabel?: ProgressMessage;
    /** Said while the ones that failed that check are being fetched. */
    downloadLabel?: ProgressMessage;
    signal?: AbortSignal;
  },
): Promise<void> {
  const total = tasks.length;

  const emit = (progress: number, message: ProgressMessage, done: number) => {
    if (!opts) return;
    emitAssetProgress({
      operationId: opts.operationId,
      progress,
      message,
      filesCompleted: done,
      filesTotal: total,
    });
  };

  const checkLabel: ProgressMessage = opts?.checkLabel ?? { key: 'progress.msg.checkingFiles' };
  const downloadLabel: ProgressMessage = opts?.downloadLabel ?? { key: 'progress.msg.downloading' };

  // ── Pass one: which of these are already here and correct ──

  emit(0, checkLabel, 0);
  let checked = 0;
  let lastCheckEmit = Date.now();

  const pending: DownloadTask[] = [];
  await forEachConcurrently(tasks, concurrency, async (task) => {
    throwIfCancelled(opts?.signal, 'Download');
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
    if (!(await fileExistsAndValid(task.dest, task.sha1, task.size))) pending.push(task);
  });

  // ── Pass two: fetch what pass one turned down ──

  let completed = total - pending.length;
  const reportDownload = () => emit(total > 0 ? completed / total : 1, downloadLabel, completed);

  // Announced only when there is something to announce. Seeding the counter
  // unconditionally put the download line on screen — at 100%, on a launch with
  // nothing missing — for the one tick before the completion event replaced it.
  if (pending.length > 0) reportDownload();

  await forEachConcurrently(pending, concurrency, async (task) => {
    await downloadFile(task.url, task.dest, task.sha1, 3, opts?.signal);
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
  signal?: AbortSignal,
): Promise<string> {
  const jarPath = path.join(versionsDir, versionId, `${versionId}.jar`);
  if (await fileExistsAndValid(jarPath, clientDl.sha1, clientDl.size)) {
    return jarPath;
  }

  log.info(`Downloading client jar for ${versionId}...`);
  await downloadFile(clientDl.url, jarPath, clientDl.sha1, 3, signal);
  return jarPath;
}

// ── Download libraries ─────────────────────────────────────

function shouldIncludeLibrary(lib: Library): boolean {
  if (!lib.rules) return true;
  let allowed = false;
  for (const rule of lib.rules) {
    const osMatch = !rule.os || rule.os.name === getMojangOsName();
    if (rule.action === 'allow' && osMatch) allowed = true;
    if (rule.action === 'disallow' && osMatch) allowed = false;
  }
  return allowed;
}

function emitAssetProgress(event: ProgressEvent): void {
  getMainWindow()?.webContents.send('progress:game-assets', event);
}

// ── Maven coordinates ──────────────────────────────────────
// Mod loader profiles (Fabric, Quilt) list libraries as bare Maven coordinates
// plus a repository URL, with no `downloads` block. Resolve them the way the
// Maven layout dictates: group/artifact/version/artifact-version[-classifier].ext

interface MavenCoords {
  /** Repo-relative path, e.g. `org/ow2/asm/asm/9.10.1/asm-9.10.1.jar` */
  path: string;
  classifier?: string;
}

function parseMavenCoords(name: string): MavenCoords | null {
  // group:artifact:version[:classifier][@ext]
  const [coords, extFromAt] = name.split('@');
  const parts = coords.split(':');
  if (parts.length < 3) return null;

  const [group, artifact, version, classifier] = parts;
  const ext = extFromAt ?? 'jar';
  const fileName = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.${ext}`;

  return {
    path: [...group.split('.'), artifact, version, fileName].join('/'),
    classifier,
  };
}

/** The `natives-<os>` classifier marks a library whose payload must be unpacked. */
function isNativeClassifier(classifier: string | undefined): boolean {
  return classifier?.startsWith('natives-') ?? false;
}

// ── Native library extraction ──────────────────────────────

const DEFAULT_NATIVE_EXCLUDES = ['META-INF/'];
const NATIVE_EXTENSIONS = ['.so', '.dll', '.dylib', '.jnilib'];

function isNativeBinary(entryName: string): boolean {
  return NATIVE_EXTENSIONS.some((ext) => entryName.toLowerCase().endsWith(ext));
}

/**
 * Unpack the native binaries out of a jar into `nativesDir`.
 *
 * Minecraft passes `-Djava.library.path=<nativesDir>` and expects the platform
 * `.so`/`.dll`/`.dylib` files to be sitting there loose. Downloading the native
 * jars is not enough — without this step the game dies on LWJGL init with
 * UnsatisfiedLinkError.
 */
async function extractNatives(
  jarPath: string,
  nativesDir: string,
  exclude: string[],
): Promise<void> {
  const excludes = [...DEFAULT_NATIVE_EXCLUDES, ...exclude];

  const zipFile = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(jarPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) reject(err ?? new Error(`Could not open ${jarPath}`));
      else resolve(zip);
    });
  });

  // `finally`, because every path out of the promise below other than the happy
  // one used to leave the archive open: an unreadable entry rejected and the
  // descriptor stayed held for as long as the launcher ran.
  try {
    await extractNativeEntries(zipFile, jarPath, nativesDir, excludes);
  } finally {
    zipFile.close();
  }
}

function extractNativeEntries(
  zipFile: yauzl.ZipFile,
  jarPath: string,
  nativesDir: string,
  excludes: string[],
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    zipFile.on('entry', (entry: yauzl.Entry) => {
      const name = entry.fileName;

      if (name.endsWith('/') || excludes.some((p) => name.startsWith(p)) || !isNativeBinary(name)) {
        zipFile.readEntry();
        return;
      }

      // Flatten: java.library.path is not searched recursively.
      const dest = path.join(nativesDir, path.basename(name));

      zipFile.openReadStream(entry, (err, readStream) => {
        if (err || !readStream) {
          reject(err ?? new Error(`Could not read ${name} from ${jarPath}`));
          return;
        }
        pipeline(readStream, createWriteStream(dest))
          .then(() => zipFile.readEntry())
          .catch(reject);
      });
    });

    zipFile.on('end', resolve);
    zipFile.on('error', reject);
    zipFile.readEntry();
  });
}

export async function ensureLibraries(
  librariesDir: string,
  meta: VersionMeta,
  nativesDir?: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const settings = await getSettings();
  const concurrency = settings.downloadConcurrency;
  const tasks: DownloadTask[] = [];
  const classpath: string[] = [];
  const nativeJars: Array<{ jarPath: string; exclude: string[] }> = [];

  for (const lib of meta.libraries) {
    if (!shouldIncludeLibrary(lib)) continue;

    const coords = parseMavenCoords(lib.name);

    if (lib.downloads?.artifact) {
      const artifact = lib.downloads.artifact;
      const dest = path.join(librariesDir, artifact.path);
      tasks.push({ url: artifact.url, dest, sha1: artifact.sha1, size: artifact.size });

      // Modern versions (1.19+) ship natives as ordinary artifacts tagged with a
      // `natives-<os>` classifier. They belong on the classpath *and* unpacked.
      if (isNativeClassifier(coords?.classifier)) {
        nativeJars.push({ jarPath: dest, exclude: lib.extract?.exclude ?? [] });
      }
      classpath.push(dest);
    } else if (lib.url && coords) {
      // Maven-style entry from a loader profile — no hashes are guaranteed, but
      // Fabric does publish sha1 alongside the coordinates when it has one.
      const dest = path.join(librariesDir, coords.path);
      const baseUrl = lib.url.endsWith('/') ? lib.url : `${lib.url}/`;
      tasks.push({ url: `${baseUrl}${coords.path}`, dest, sha1: lib.sha1, size: lib.size });
      classpath.push(dest);
    }

    // Legacy versions (≤1.18) declare a `natives` map pointing into `classifiers`.
    // These are extraction-only — never on the classpath.
    if (lib.natives && lib.downloads?.classifiers) {
      const nativeKey = lib.natives[getMojangOsName()];
      if (nativeKey) {
        const classifier = lib.downloads.classifiers[nativeKey];
        if (classifier) {
          const dest = path.join(librariesDir, classifier.path);
          tasks.push({ url: classifier.url, dest, sha1: classifier.sha1, size: classifier.size });
          nativeJars.push({ jarPath: dest, exclude: lib.extract?.exclude ?? [] });
        }
      }
    }
  }

  log.info(`Ensuring ${tasks.length} libraries...`);
  await downloadBatch(tasks, concurrency, {
    operationId: `libraries-${meta.id}`,
    checkLabel: { key: 'progress.msg.checkingLibraries', vars: { version: meta.id } },
    downloadLabel: { key: 'progress.msg.libraries', vars: { version: meta.id } },
    signal,
  });

  if (nativesDir && nativeJars.length > 0) {
    await fs.mkdir(nativesDir, { recursive: true });
    log.info(`Extracting ${nativeJars.length} native libraries to ${nativesDir}...`);
    for (const { jarPath, exclude } of nativeJars) {
      try {
        await extractNatives(jarPath, nativesDir, exclude);
      } catch (err) {
        log.warn(`Failed to extract natives from ${path.basename(jarPath)}: ${err}`);
      }
    }
  }

  return classpath;
}

// ── Download assets ────────────────────────────────────────

export async function ensureAssets(
  assetsDir: string,
  meta: VersionMeta,
  signal?: AbortSignal,
): Promise<void> {
  const settings = await getSettings();
  const indexDir = path.join(assetsDir, 'indexes');
  const objectsDir = path.join(assetsDir, 'objects');
  await fs.mkdir(indexDir, { recursive: true });

  const indexFile = path.join(indexDir, `${meta.assetIndex.id}.json`);

  // Download asset index
  if (!(await fileExistsAndValid(indexFile, meta.assetIndex.sha1))) {
    await downloadFile(meta.assetIndex.url, indexFile, meta.assetIndex.sha1, 3, signal);
  }

  const indexRaw = await fs.readFile(indexFile, 'utf-8');
  const assetIndex = JSON.parse(indexRaw) as AssetIndex;

  const tasks: DownloadTask[] = [];
  for (const [, obj] of Object.entries(assetIndex.objects)) {
    const prefix = obj.hash.substring(0, 2);
    const dest = path.join(objectsDir, prefix, obj.hash);
    const url = `${MOJANG_RESOURCES}/${prefix}/${obj.hash}`;
    tasks.push({ url, dest, sha1: obj.hash, size: obj.size });
  }

  log.info(`Ensuring ${tasks.length} assets...`);
  await downloadBatch(tasks, settings.downloadConcurrency, {
    operationId: `assets-${meta.id}`,
    checkLabel: { key: 'progress.msg.checkingAssets' },
    downloadLabel: { key: 'progress.msg.assets' },
    signal,
  });
}
