import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from '../../main/logger';
import { paths } from '../config/paths';
import { FABRIC_META_API, QUILT_META_API } from '../../shared/constants';
import { getMainWindow } from '../../main/window';
import {
  getForgeVersions,
  getNeoForgeVersions,
  installForgeLike,
  isForgeLikeInstalled,
} from './forge-installer';
import type { ModLoaderType, ProgressEvent, LoaderVersion } from '../../shared/ipc-types';

function emitLoaderProgress(event: ProgressEvent): void {
  getMainWindow()?.webContents.send('progress:loader-install', event);
}

// ── Fabric ─────────────────────────────────────────────────

async function getFabricVersions(mcVersion: string): Promise<LoaderVersion[]> {
  const res = await fetch(`${FABRIC_META_API}/versions/loader/${mcVersion}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Fabric API error: ${res.status}`);

  const data = (await res.json()) as Array<{
    loader: { version: string; stable: boolean };
  }>;

  return data.map((entry) => ({
    version: entry.loader.version,
    stable: entry.loader.stable,
  }));
}

async function installFabric(loaderVersion: string, mcVersion: string): Promise<void> {
  const profileJsonUrl = `${FABRIC_META_API}/versions/loader/${mcVersion}/${loaderVersion}/profile/json`;
  const opId = `loader-fabric-${mcVersion}-${loaderVersion}`;

  emitLoaderProgress({ operationId: opId, progress: 0, message: 'Pobieranie profilu Fabric...' });

  log.info(`Fetching Fabric profile JSON for MC ${mcVersion} / loader ${loaderVersion}`);
  const res = await fetch(profileJsonUrl, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Failed to fetch Fabric profile: ${res.status}`);

  const profileJson = await res.json();
  const destDir = path.join(paths.loadersDir, 'fabric', `${mcVersion}-${loaderVersion}`);
  await fs.mkdir(destDir, { recursive: true });
  await fs.writeFile(
    path.join(destDir, 'fabric-profile.json'),
    JSON.stringify(profileJson, null, 2),
    'utf-8',
  );

  emitLoaderProgress({ operationId: opId, progress: 1, message: 'Zainstalowano Fabric' });
  log.info(`Installed Fabric loader ${loaderVersion} for MC ${mcVersion}`);
}

function isFabricInstalled(loaderVersion: string, mcVersion: string): Promise<boolean> {
  const profilePath = path.join(
    paths.loadersDir,
    'fabric',
    `${mcVersion}-${loaderVersion}`,
    'fabric-profile.json',
  );
  return fs
    .access(profilePath)
    .then(() => true)
    .catch(() => false);
}

// ── Quilt ──────────────────────────────────────────────────

async function getQuiltVersions(mcVersion: string): Promise<LoaderVersion[]> {
  const res = await fetch(`${QUILT_META_API}/versions/loader/${mcVersion}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Quilt API error: ${res.status}`);

  const data = (await res.json()) as Array<{
    loader: { version: string };
  }>;

  return data.map((entry) => ({
    version: entry.loader.version,
    stable: true, // Quilt doesn't distinguish stable/unstable in API
  }));
}

async function installQuilt(loaderVersion: string, mcVersion: string): Promise<void> {
  const profileJsonUrl = `${QUILT_META_API}/versions/loader/${mcVersion}/${loaderVersion}/profile/json`;
  const opId = `loader-quilt-${mcVersion}-${loaderVersion}`;

  emitLoaderProgress({ operationId: opId, progress: 0, message: 'Pobieranie profilu Quilt...' });

  log.info(`Fetching Quilt profile JSON for MC ${mcVersion} / loader ${loaderVersion}`);
  const res = await fetch(profileJsonUrl, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Failed to fetch Quilt profile: ${res.status}`);

  const profileJson = await res.json();
  const destDir = path.join(paths.loadersDir, 'quilt', `${mcVersion}-${loaderVersion}`);
  await fs.mkdir(destDir, { recursive: true });
  await fs.writeFile(
    path.join(destDir, 'quilt-profile.json'),
    JSON.stringify(profileJson, null, 2),
    'utf-8',
  );

  emitLoaderProgress({ operationId: opId, progress: 1, message: 'Zainstalowano Quilt' });
  log.info(`Installed Quilt loader ${loaderVersion} for MC ${mcVersion}`);
}

function isQuiltInstalled(loaderVersion: string, mcVersion: string): Promise<boolean> {
  const profilePath = path.join(
    paths.loadersDir,
    'quilt',
    `${mcVersion}-${loaderVersion}`,
    'quilt-profile.json',
  );
  return fs
    .access(profilePath)
    .then(() => true)
    .catch(() => false);
}

// ── Unified API (matches ipc-handlers imports) ─────────────

export async function getLoaderVersions(
  loader: ModLoaderType,
  mcVersion: string,
): Promise<LoaderVersion[]> {
  switch (loader) {
    case 'fabric':
      return getFabricVersions(mcVersion);
    case 'quilt':
      return getQuiltVersions(mcVersion);
    case 'forge':
      return getForgeVersions(mcVersion);
    case 'neoforge':
      return getNeoForgeVersions(mcVersion);
    case 'vanilla':
      return [];
    default:
      throw new Error(`Unknown loader: ${loader}`);
  }
}

export async function installLoader(
  loader: ModLoaderType,
  loaderVersion: string,
  mcVersion: string,
): Promise<void> {
  switch (loader) {
    case 'fabric':
      return installFabric(loaderVersion, mcVersion);
    case 'quilt':
      return installQuilt(loaderVersion, mcVersion);
    case 'forge':
    case 'neoforge':
      return installForgeLike(loader, loaderVersion, mcVersion, (progress, message) =>
        emitLoaderProgress({
          operationId: `loader-${loader}-${mcVersion}-${loaderVersion}`,
          progress,
          message,
        }),
      );
    case 'vanilla':
      return; // nothing to install
    default:
      throw new Error(`Unknown loader: ${loader}`);
  }
}

export async function isLoaderInstalled(
  loader: ModLoaderType,
  loaderVersion: string,
  mcVersion: string,
): Promise<boolean> {
  switch (loader) {
    case 'fabric':
      return isFabricInstalled(loaderVersion, mcVersion);
    case 'quilt':
      return isQuiltInstalled(loaderVersion, mcVersion);
    case 'forge':
    case 'neoforge':
      return isForgeLikeInstalled(loader, loaderVersion, mcVersion);
    case 'vanilla':
      return true;
    default:
      return false;
  }
}
