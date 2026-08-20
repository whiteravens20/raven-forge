import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { log } from '../../main/logger';
import { paths } from '../config/paths';
import { ADOPTIUM_API } from '../../shared/constants';
import { verifyDownload } from '../mods/integrity';
import { parseJavaVersion } from '../minecraft/java-requirement';
import { LaunchRefusedError } from '../minecraft/launch-errors';
import { getMainWindow } from '../../main/window';
import { downloadToFile } from '../net/download';
import { throwIfCancelled, withTimeout } from '../util/cancellation';
import type { JavaInstallation, ProgressEvent } from '../../shared/ipc-types';

const execFileAsync = promisify(execFile);

// ── Helpers ────────────────────────────────────────────────

function getPlatformForAdoptium(): string {
  switch (process.platform) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'mac';
    default:
      return 'linux';
  }
}

function getArchForAdoptium(): string {
  switch (process.arch) {
    case 'arm64':
      return 'aarch64';
    default:
      return 'x64';
  }
}

function getJavaExecutable(): string {
  return process.platform === 'win32' ? 'java.exe' : 'java';
}

/**
 * Where a managed JRE lives.
 *
 * The launcher executes `bin/java` out of this directory for the rest of the
 * session, and the number that names it originates in a version meta fetched
 * over the network — `requiredJavaFor` bounds it, but that is a decision made
 * two modules away. The name is therefore built from digits rather than from
 * whatever was passed: `jre-21`, and nothing that is not that shape.
 */
function getManagedJavaDir(majorVersion: number): string {
  const digits = String(majorVersion).replace(/\D/g, '');
  return path.join(paths.javaDir, `jre-${digits}`);
}

function getManagedJavaPath(majorVersion: number): string {
  return path.join(getManagedJavaDir(majorVersion), 'bin', getJavaExecutable());
}

// ── Ask a binary what it is ────────────────────────────────

/**
 * The major version of the JVM at `binPath`, or null if it is not one.
 *
 * Null covers every way of not being a Java runtime — no such file, not
 * executable, an executable that prints something else, one that hangs. They
 * are one answer here because they are one answer to the caller: this is not a
 * runtime the game can be started with.
 */
export async function probeJava(binPath: string): Promise<number | null> {
  try {
    const { stderr } = await execFileAsync(binPath, ['-version'], { timeout: 5000 });
    return parseJavaVersion(stderr);
  } catch {
    return null;
  }
}

/**
 * The runtime a profile asked for by name, checked before the game gets it.
 *
 * A path the player chose is not a path the launcher maintains: the JDK can be
 * uninstalled, the drive it lives on unplugged, the file replaced by something
 * that is not a JVM at all. Left unchecked, all of those arrive as a `spawn`
 * failure or, worse, as `UnsupportedClassVersionError` several seconds into a
 * game that looks like it started — neither of which mentions the profile
 * setting that caused it.
 *
 * Refusing outright rather than quietly falling back to the managed runtime:
 * a profile that says which JVM to use and then silently runs a different one
 * is how "it works on my machine" gets written.
 */
export async function resolveChosenJava(
  binPath: string,
  requiredVersion: number,
): Promise<JavaInstallation> {
  const version = await probeJava(binPath);
  if (version === null) {
    throw new LaunchRefusedError(
      { key: 'launchError.javaNotRuntime', vars: { path: binPath } },
      `This profile is set to launch with ${binPath}, and that is not a Java runtime this ` +
        `machine can run. Point it somewhere else in the profile editor, or clear the field to ` +
        `use the runtime the launcher installs itself.`,
    );
  }
  if (version < requiredVersion) {
    throw new LaunchRefusedError(
      {
        key: 'launchError.javaTooOld',
        vars: { path: binPath, found: version, required: requiredVersion },
      },
      `This profile is set to launch with ${binPath}, which is Java ${version}, and this ` +
        `version of Minecraft needs Java ${requiredVersion}. It would start and then stop with ` +
        `an error about class file versions. Clear the field to use the runtime the launcher ` +
        `installs itself.`,
    );
  }
  // Newer than required is the player's call. It is usually fine and sometimes
  // exactly what they want, and refusing it would rule out the only JVM some
  // machines have.
  if (version > requiredVersion) {
    log.info(
      `Profile Java ${version} at ${binPath} is newer than the ${requiredVersion} asked for`,
    );
  }
  return { version, path: binPath, vendor: 'chosen in the profile', managed: false };
}

// ── Detect system Java ─────────────────────────────────────

export async function detectSystemJava(): Promise<JavaInstallation[]> {
  const installations: JavaInstallation[] = [];

  const candidates: string[] = [];

  if (process.platform === 'win32') {
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    for (const base of [programFiles, programFilesX86]) {
      try {
        const entries = await fs.readdir(base);
        for (const entry of entries) {
          if (/^(java|jdk|jre|adopt|temurin|zulu|corretto)/i.test(entry)) {
            candidates.push(path.join(base, entry, 'bin', 'java.exe'));
          }
        }
      } catch {
        /* dir doesn't exist */
      }
    }
  } else {
    // Linux/macOS common paths
    candidates.push(
      '/usr/bin/java',
      '/usr/local/bin/java',
      '/usr/lib/jvm/default/bin/java',
      '/usr/lib/jvm/java/bin/java',
    );
    // Add all /usr/lib/jvm entries
    try {
      const jvmEntries = await fs.readdir('/usr/lib/jvm');
      for (const entry of jvmEntries) {
        candidates.push(path.join('/usr/lib/jvm', entry, 'bin', 'java'));
      }
    } catch {
      /* no jvm dir */
    }
  }

  // Also check JAVA_HOME
  if (process.env.JAVA_HOME) {
    candidates.push(path.join(process.env.JAVA_HOME, 'bin', getJavaExecutable()));
  }

  const seen = new Set<string>();
  for (const candidate of candidates) {
    try {
      const resolved = await fs.realpath(candidate);
      if (seen.has(resolved)) continue;
      seen.add(resolved);

      const version = await probeJava(candidate);
      if (version) {
        installations.push({
          version,
          path: candidate,
          vendor: 'system',
          managed: false,
        });
      }
    } catch {
      /* realpath failed — nothing there */
    }
  }

  return installations;
}

function emitJavaProgress(event: ProgressEvent): void {
  getMainWindow()?.webContents.send('progress:java-download', event);
}

// ── Download & install from Adoptium ───────────────────────

/** The one field of Adoptium's assets response this needs. */
interface AdoptiumAsset {
  binary?: { package?: { link?: string; checksum?: string } };
}

/**
 * Where to get a JRE, and what it should hash to.
 *
 * Resolved through `/assets/latest` rather than through `/binary/latest`,
 * because the assets response carries the sha256 alongside the link and the
 * binary endpoint carries only a redirect. Everything downloaded here is
 * extracted and then executed as the JVM on every launch from that point on, so
 * "what should this hash to" is not a question to leave unanswered.
 *
 * A missing checksum is therefore fatal, not a reason to fall back to the
 * unverified binary endpoint: HTTPS authenticates Adoptium, but the checksum is
 * what catches a tampered mirror or a download that arrived wrong, and a runtime
 * that runs on every launch is the last thing to install unverified. If the
 * resolve fails, the install fails with it — the binary endpoint is the same
 * host, so falling back to it bought availability only by dropping the check.
 */
async function resolveAdoptiumBinary(
  majorVersion: number,
  platform: string,
  arch: string,
  signal?: AbortSignal,
): Promise<{ url: string; sha256: string }> {
  const query = new URLSearchParams({
    architecture: arch,
    image_type: 'jre',
    os: platform,
    vendor: 'eclipse',
  });
  const res = await fetch(`${ADOPTIUM_API}/assets/latest/${majorVersion}/hotspot?${query}`, {
    signal: withTimeout(signal, 15_000),
  });
  if (!res.ok) {
    throw new Error(`Could not reach Adoptium to resolve JRE ${majorVersion}: HTTP ${res.status}`);
  }

  const assets = (await res.json()) as AdoptiumAsset[];
  const pkg = assets.find((a) => a.binary?.package?.link)?.binary?.package;
  if (!pkg?.link) {
    throw new Error(`Adoptium listed no JRE ${majorVersion} binary for ${platform}/${arch}`);
  }
  if (!pkg.checksum) {
    throw new Error(
      `Adoptium listed JRE ${majorVersion} for ${platform}/${arch} with no checksum — ` +
        'refusing to install a runtime that cannot be verified',
    );
  }

  return { url: pkg.link, sha256: pkg.checksum };
}

async function downloadAdoptium(majorVersion: number, signal?: AbortSignal): Promise<string> {
  const platform = getPlatformForAdoptium();
  const arch = getArchForAdoptium();
  const ext = platform === 'windows' ? 'zip' : 'tar.gz';

  const { url, sha256 } = await resolveAdoptiumBinary(majorVersion, platform, arch, signal);

  log.info(`Downloading Adoptium JRE ${majorVersion} from ${url}`);

  emitJavaProgress({
    operationId: `java-${majorVersion}`,
    progress: 0,
    message: { key: 'progress.msg.javaDownloading', vars: { version: majorVersion } },
  });

  const tmpFile = path.join(paths.cacheDir, `jre-${majorVersion}.${ext}`);
  await fs.mkdir(paths.cacheDir, { recursive: true });

  // Through the shared downloader, which is where the stall timeout, the
  // backpressure and the delete-on-failure live. This had its own loop with no
  // timeout and no signal of any kind: a link that went quiet mid-archive left
  // `reader.read()` unresolved forever, so the launch hung on a step nobody
  // could cancel and the only way out was to kill the launcher.
  let lastReported = 0;
  let received = 0;
  let total: number | undefined;
  await downloadToFile(url, tmpFile, {
    signal,
    onProgress: (bytes, declared) => {
      received = bytes;
      total = declared;
      // Throttle progress updates to every 5%
      const pct = declared ? bytes / declared : 0;
      if (pct - lastReported < 0.05) return;
      lastReported = pct;
      emitJavaProgress({
        operationId: `java-${majorVersion}`,
        progress: Math.min(0.95, pct),
        message: { key: 'progress.msg.javaDownloading', vars: { version: majorVersion } },
        bytesDownloaded: bytes,
        bytesTotal: declared,
      });
    },
  });

  // Deletes the archive and throws on mismatch. Everything inside it is about
  // to be extracted and then run as the JVM for every launch, and the resolver
  // guarantees a checksum, so this always runs.
  await verifyDownload(tmpFile, { sha256 }, `JRE ${majorVersion}`);

  emitJavaProgress({
    operationId: `java-${majorVersion}`,
    progress: 1,
    message: { key: 'progress.msg.javaReady', vars: { version: majorVersion } },
    bytesDownloaded: received,
    bytesTotal: total ?? received,
  });

  log.info(`Downloaded JRE ${majorVersion} to ${tmpFile}`);
  return tmpFile;
}

async function extractArchive(
  archivePath: string,
  destDir: string,
  signal?: AbortSignal,
): Promise<void> {
  await fs.rm(destDir, { recursive: true, force: true });
  await fs.mkdir(destDir, { recursive: true });

  // `tar` handles the zip too: Windows 10 1803 and later ship bsdtar, which
  // reads zip archives. The `else` is not decoration — without it an extension
  // this does not recognise made the whole function a silent no-op, and the
  // failure surfaced several steps later as "installed JRE but failed to
  // verify", which points at the wrong thing entirely.
  if (archivePath.endsWith('.tar.gz')) {
    await execFileAsync('tar', ['-xzf', archivePath, '-C', destDir, '--strip-components=1'], {
      signal,
    });
  } else if (archivePath.endsWith('.zip')) {
    await execFileAsync('tar', ['-xf', archivePath, '-C', destDir, '--strip-components=1'], {
      signal,
    });
  } else {
    throw new Error(`Cannot extract ${path.basename(archivePath)}: unrecognised archive type`);
  }

  // Ensure bin/java is executable
  const javaExec = path.join(destDir, 'bin', getJavaExecutable());
  try {
    await fs.chmod(javaExec, 0o755);
  } catch {
    /* Windows doesn't need chmod */
  }

  // Clean up archive
  await fs.rm(archivePath, { force: true });
  log.info(`Extracted JRE to ${destDir}`);
}

// ── Public API ─────────────────────────────────────────────

/**
 * Ensure a specific Java major version is available.
 * Downloads from Adoptium if not already installed.
 * Returns the installation info.
 */
/**
 * Ensure a specific Java major version is available, downloading it from
 * Adoptium when it is not.
 *
 * "Already installed" used to mean nothing more than `bin/java` being present
 * and executable, and the `-version` check ran only on the freshly-extracted
 * path. But `extractArchive` starts by deleting the destination, so an
 * interrupted extraction can leave exactly that: the launcher binary in place
 * and half the runtime missing. Every later launch then took the short path,
 * said "already installed", and died inside the JVM with an error naming none of
 * this. Proving the runtime actually starts costs one short subprocess per
 * launch and is the only way to tell the two states apart.
 */
export async function ensureJavaVersion(
  majorVersion: number,
  signal?: AbortSignal,
): Promise<JavaInstallation> {
  const dir = getManagedJavaDir(majorVersion);
  const javaPath = getManagedJavaPath(majorVersion);
  const installation: JavaInstallation = {
    version: majorVersion,
    path: javaPath,
    vendor: 'Adoptium Temurin',
    managed: true,
  };

  if (await runtimeWorks(javaPath)) {
    log.info(`Java ${majorVersion} already installed at ${javaPath}`);
    return installation;
  }

  throwIfCancelled(signal, 'Java install');
  const archivePath = await downloadAdoptium(majorVersion, signal);
  throwIfCancelled(signal, 'Java install');
  await extractArchive(archivePath, dir, signal);

  if (!(await runtimeWorks(javaPath))) {
    throw new Error(`Installed JRE ${majorVersion} but it does not run`);
  }
  return installation;
}

/** Does this path start a JVM? The one question that separates a usable runtime
 * from a directory that merely contains a file called `java`. */
async function runtimeWorks(javaPath: string): Promise<boolean> {
  try {
    await fs.access(javaPath, fss.constants.X_OK);
    const { stderr } = await execFileAsync(javaPath, ['-version'], { timeout: 10000 });
    log.info(`Verified Java ${parseJavaVersion(stderr)} at ${javaPath}`);
    return true;
  } catch {
    return false;
  }
}
