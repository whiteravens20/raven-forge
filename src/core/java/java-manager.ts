import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createWriteStream } from 'node:fs';
import { log } from '../../main/logger';
import { paths } from '../config/paths';
import { ADOPTIUM_API } from '../../shared/constants';
import { getMainWindow } from '../../main/window';
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

function getManagedJavaDir(majorVersion: number): string {
  return path.join(paths.javaDir, `jre-${majorVersion}`);
}

function getManagedJavaPath(majorVersion: number): string {
  return path.join(getManagedJavaDir(majorVersion), 'bin', getJavaExecutable());
}

// ── Parse java version from java -version output ──────────

function parseJavaVersion(stderr: string): number | null {
  // java -version outputs to stderr: openjdk version "21.0.2" or "1.8.0_392"
  const match = stderr.match(/version "(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  const major = parseInt(match[1], 10);
  // Java 8 reports as "1.8.x", newer versions report as "17.x", "21.x"
  return major === 1 ? parseInt(match[2], 10) : major;
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

      const { stderr } = await execFileAsync(candidate, ['-version'], { timeout: 5000 });
      const version = parseJavaVersion(stderr);
      if (version) {
        installations.push({
          version,
          path: candidate,
          vendor: 'system',
          managed: false,
        });
      }
    } catch {
      /* not a valid java */
    }
  }

  return installations;
}

// ── List managed installations ─────────────────────────────

export async function getJavaInstallations(): Promise<JavaInstallation[]> {
  const managed: JavaInstallation[] = [];

  try {
    const entries = await fs.readdir(paths.javaDir);
    for (const entry of entries) {
      const match = entry.match(/^jre-(\d+)$/);
      if (!match) continue;
      const majorVersion = parseInt(match[1], 10);
      const javaPath = getManagedJavaPath(majorVersion);
      try {
        await fs.access(javaPath, fss.constants.X_OK);
        managed.push({
          version: majorVersion,
          path: javaPath,
          vendor: 'Adoptium Temurin',
          managed: true,
        });
      } catch {
        /* not valid */
      }
    }
  } catch {
    /* dir doesn't exist yet */
  }

  const system = await detectSystemJava();
  return [...managed, ...system];
}

function emitJavaProgress(event: ProgressEvent): void {
  getMainWindow()?.webContents.send('progress:java-download', event);
}

// ── Download & install from Adoptium ───────────────────────

async function downloadAdoptium(majorVersion: number): Promise<string> {
  const platform = getPlatformForAdoptium();
  const arch = getArchForAdoptium();
  const ext = platform === 'windows' ? 'zip' : 'tar.gz';

  const url = `${ADOPTIUM_API}/binary/latest/${majorVersion}/ga/${platform}/${arch}/jre/hotspot/normal/eclipse?project=jdk`;

  log.info(`Downloading Adoptium JRE ${majorVersion} from ${url}`);

  emitJavaProgress({
    operationId: `java-${majorVersion}`,
    progress: 0,
    message: `Pobieranie Javy ${majorVersion}...`,
  });

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download JRE ${majorVersion}: ${res.status} ${res.statusText}`);
  }

  const contentLength = Number(res.headers.get('content-length')) || 0;

  const tmpFile = path.join(paths.cacheDir, `jre-${majorVersion}.${ext}`);
  await fs.mkdir(paths.cacheDir, { recursive: true });

  const writable = createWriteStream(tmpFile);
  const reader = res.body.getReader();

  let bytesDownloaded = 0;
  let lastReported = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      writable.write(value);
      bytesDownloaded += value.length;

      // Throttle progress updates to every 5%
      const pct = contentLength > 0 ? bytesDownloaded / contentLength : 0;
      if (pct - lastReported >= 0.05) {
        lastReported = pct;
        emitJavaProgress({
          operationId: `java-${majorVersion}`,
          progress: Math.min(0.95, pct),
          message: `Pobieranie Javy ${majorVersion}...`,
          bytesDownloaded,
          bytesTotal: contentLength > 0 ? contentLength : undefined,
        });
      }
    }
    writable.end();
    await new Promise<void>((resolve, reject) => {
      writable.on('finish', resolve);
      writable.on('error', reject);
    });
  } catch (err) {
    writable.destroy();
    await fs.rm(tmpFile, { force: true });
    throw err;
  }

  emitJavaProgress({
    operationId: `java-${majorVersion}`,
    progress: 1,
    message: `JRE ${majorVersion} pobrano`,
    bytesDownloaded,
    bytesTotal: contentLength > 0 ? contentLength : bytesDownloaded,
  });

  log.info(`Downloaded JRE ${majorVersion} to ${tmpFile}`);
  return tmpFile;
}

async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  await fs.rm(destDir, { recursive: true, force: true });
  await fs.mkdir(destDir, { recursive: true });

  if (archivePath.endsWith('.tar.gz')) {
    await execFileAsync('tar', ['-xzf', archivePath, '-C', destDir, '--strip-components=1']);
  } else if (archivePath.endsWith('.zip')) {
    await execFileAsync('tar', ['-xf', archivePath, '-C', destDir, '--strip-components=1']);
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
export async function ensureJavaVersion(majorVersion: number): Promise<JavaInstallation> {
  const dir = getManagedJavaDir(majorVersion);
  const javaPath = getManagedJavaPath(majorVersion);

  // Check if already installed
  try {
    await fs.access(javaPath, fss.constants.X_OK);
    log.info(`Java ${majorVersion} already installed at ${javaPath}`);
    return {
      version: majorVersion,
      path: javaPath,
      vendor: 'Adoptium Temurin',
      managed: true,
    };
  } catch {
    /* not installed */
  }

  // Download and extract
  const archivePath = await downloadAdoptium(majorVersion);
  await extractArchive(archivePath, dir);

  // Verify
  try {
    const { stderr } = await execFileAsync(javaPath, ['-version'], { timeout: 10000 });
    const detectedVersion = parseJavaVersion(stderr);
    log.info(`Verified Java ${detectedVersion} at ${javaPath}`);
  } catch (err) {
    throw new Error(`Installed JRE ${majorVersion} but failed to verify: ${err}`);
  }

  return {
    version: majorVersion,
    path: javaPath,
    vendor: 'Adoptium Temurin',
    managed: true,
  };
}
