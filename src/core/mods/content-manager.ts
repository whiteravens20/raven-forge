import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { log } from '../../main/logger';
import { paths } from '../config/paths';
import { getVersion, getModVersions, getProjectTitle, primaryFile } from './modrinth-api';
import { getProfile } from '../profiles/profile-manager';
import { applyResourcePackOrder } from '../minecraft/options-file';
import { sha256File, fileMatches, verifyDownload } from './integrity';
import type { InstalledMod } from '../../shared/ipc-types';
import type { ResourcePackEntry, ShaderEntry } from '../../shared/manifest-schema';

type ContentKind = 'shaders' | 'resourcepacks';

function targetDir(kind: ContentKind, profileId: string): string {
  return kind === 'shaders'
    ? paths.profileShadersDir(profileId)
    : paths.profileResourcePacksDir(profileId);
}

function indexPath(kind: ContentKind, profileId: string): string {
  const fileName = kind === 'shaders' ? 'shaders.lock' : 'resourcepacks.lock';
  return path.join(paths.profileDir(profileId), fileName);
}

async function readIndex(kind: ContentKind, profileId: string): Promise<InstalledMod[]> {
  try {
    const raw = await fs.readFile(indexPath(kind, profileId), 'utf-8');
    return JSON.parse(raw) as InstalledMod[];
  } catch {
    return [];
  }
}

async function writeIndex(
  kind: ContentKind,
  profileId: string,
  items: InstalledMod[],
): Promise<void> {
  const file = indexPath(kind, profileId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(items, null, 2), 'utf-8');
}

/** No data for this long means the transfer is dead, not merely slow. */
const STALL_TIMEOUT_MS = 45_000;

/**
 * Stream a download to disk, failing on a stall rather than on total duration.
 *
 * The obvious `AbortSignal.timeout(60_000)` is wrong here and was: that signal
 * governs the *body stream* as well as the request, so a 90 MB resource pack on
 * a normal connection aborts halfway every time. What actually indicates a dead
 * transfer is silence, so the deadline resets on every chunk.
 *
 * A failed download must not leave its partial file behind. It would sit in
 * `resourcepacks/` looking installed while being absent from the index — which
 * is exactly the state this function used to produce.
 */
async function downloadToFile(url: string, dest: string): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });

  const controller = new AbortController();
  let stall = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS);
  const keepAlive = () => {
    clearTimeout(stall);
    stall = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS);
  };

  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal });
    if (!res.ok || !res.body) {
      throw new Error(`Download failed (${res.status}): ${new URL(url).host}`);
    }

    const writable = createWriteStream(dest);
    const reader = res.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        keepAlive();
        if (!writable.write(value)) {
          await new Promise<void>((r) => writable.once('drain', r));
        }
      }
      writable.end();
      await new Promise<void>((resolve, reject) => {
        writable.on('finish', resolve);
        writable.on('error', reject);
      });
    } catch (err) {
      writable.destroy();
      throw err;
    }
  } catch (err) {
    await fs.rm(dest, { force: true });
    if (controller.signal.aborted) {
      throw new Error(`Download stalled for ${STALL_TIMEOUT_MS / 1000}s and was cancelled: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(stall);
  }
}

export async function listContent(kind: ContentKind, profileId: string): Promise<InstalledMod[]> {
  return readIndex(kind, profileId);
}

/**
 * Push the resource-pack index into the profile's `options.txt`.
 *
 * Run after anything that changes which packs exist or in what order. Dropping
 * a zip into `resourcepacks/` does not switch it on — the game loads what
 * `options.txt` names, and nothing else. Shaders need no equivalent: Iris and
 * OptiFine read their own config, not this file.
 */
async function syncResourcePackSelection(profileId: string): Promise<void> {
  const items = await readIndex('resourcepacks', profileId);
  await applyResourcePackOrder(
    paths.profileGameDir(profileId),
    items.filter((p) => p.enabled !== false).map((p) => p.fileName),
  );
}

/**
 * Install shader / resource pack from a source string:
 *   - "modrinth:<projectId>" — newest build for the profile's Minecraft version
 *   - "url:https://..."       — direct URL to .zip
 *   - "file:/abs/path.zip"    — local file
 *
 * `versionId` overrides the choice for the Modrinth case, and is how an install
 * the player accepted a compatibility warning about gets the build the warning
 * was about.
 */
export async function installContent(
  kind: ContentKind,
  profileId: string,
  source: string,
  versionId?: string,
): Promise<InstalledMod> {
  const dir = targetDir(kind, profileId);
  await fs.mkdir(dir, { recursive: true });

  let downloadUrl: string;
  let fileName: string;
  let displayName: string;
  let version = 'unknown';
  let modrinthProjectId: string | undefined;

  if (source.startsWith('modrinth:')) {
    const projectId = source.slice('modrinth:'.length);
    modrinthProjectId = projectId;

    // Pinned to the profile's Minecraft version. Taking whatever is newest —
    // as this did — puts a pack built for 1.21.8 into a 1.20.1 profile, where a
    // shader fails to compile and a resource pack lands in the game's
    // "incompatible" list. Both look like a successful install from here.
    const profile = await getProfile(profileId);
    const chosen = versionId
      ? await getVersion(versionId)
      : (await getModVersions(projectId, profile?.minecraftVersion))[0];
    if (!chosen) {
      throw new Error(
        `No ${kind === 'shaders' ? 'shader' : 'resource pack'} build for MC ` +
          `${profile?.minecraftVersion ?? 'unknown'} (project ${projectId})`,
      );
    }

    const fileInfo = primaryFile(chosen);
    downloadUrl = fileInfo.url;
    fileName = fileInfo.filename;
    // The project's title, not the version's. `ModrinthVersion.name` is a build
    // label — Complementary Reimagined publishes its as `r5.8.1`, so the
    // installed list read "r5.8.1" where a pack name belonged.
    displayName = await getProjectTitle(projectId);
    version = chosen.version_number || chosen.id;
  } else if (source.startsWith('url:')) {
    downloadUrl = source.slice('url:'.length);
    fileName = path.basename(new URL(downloadUrl).pathname) || `${kind}-${Date.now()}.zip`;
    displayName = fileName.replace(/\.zip$/i, '');
  } else if (source.startsWith('file:')) {
    const localPath = source.slice('file:'.length);
    fileName = path.basename(localPath);
    displayName = fileName.replace(/\.zip$/i, '');
    const dest = path.join(dir, fileName);
    await fs.copyFile(localPath, dest);
    const hash = await sha256File(dest);
    const installed: InstalledMod = {
      id: `local-${crypto.randomUUID()}`,
      name: displayName,
      version: 'local',
      source: 'local',
      fileName,
      sha256: hash,
      required: false,
      side: 'client',
      enabled: true,
      fromManifest: false,
    };
    const items = await readIndex(kind, profileId);
    items.push(installed);
    await writeIndex(kind, profileId, items);
    if (kind === 'resourcepacks') await syncResourcePackSelection(profileId);
    log.info(`Installed ${kind.slice(0, -1)} from file: ${fileName}`);
    return installed;
  } else {
    throw new Error(`Unsupported source format: ${source} (expected modrinth:|url:|file:)`);
  }

  const dest = path.join(dir, fileName);
  log.info(`Downloading ${kind.slice(0, -1)}: ${displayName}`);
  await downloadToFile(downloadUrl, dest);
  const hash = await sha256File(dest);

  const installed: InstalledMod = {
    id: modrinthProjectId ?? `url-${crypto.randomUUID()}`,
    name: displayName,
    version,
    source: modrinthProjectId ? 'modrinth' : 'url',
    fileName,
    sha256: hash,
    required: false,
    side: 'client',
    enabled: true,
    fromManifest: false,
  };

  const items = await readIndex(kind, profileId);
  const idx = items.findIndex((m) => m.id === installed.id);
  if (idx >= 0) {
    try {
      await fs.rm(path.join(dir, items[idx].fileName), { force: true });
    } catch {
      /* ok */
    }
    items[idx] = installed;
  } else {
    items.push(installed);
  }
  await writeIndex(kind, profileId, items);
  if (kind === 'resourcepacks') await syncResourcePackSelection(profileId);
  return installed;
}

/**
 * Reconcile a profile's shaders / resource packs against a server manifest.
 *
 * Entries already present with a matching sha256 are left alone. Items
 * previously installed *from a manifest* that the manifest no longer lists are
 * removed; anything the user installed themselves is never touched.
 */
export async function syncContentFromManifest(
  kind: ContentKind,
  profileId: string,
  entries: Array<ResourcePackEntry | ShaderEntry>,
  mcVersion: string,
): Promise<number> {
  const dir = targetDir(kind, profileId);
  await fs.mkdir(dir, { recursive: true });

  const existing = await readIndex(kind, profileId);
  const userInstalled = existing.filter((item) => !item.fromManifest);
  const fromManifest: InstalledMod[] = [];

  for (const entry of entries) {
    const previous = existing.find((item) => item.id === entry.id);

    let downloadUrl: string;
    let fileName: string;
    let version = entry.version ?? 'unknown';

    if (entry.url) {
      // Direct URL — no API lookup needed, whatever the declared source is.
      downloadUrl = entry.url;
      fileName = entry.fileName ?? path.basename(new URL(entry.url).pathname) ?? `${entry.id}.zip`;
    } else if (entry.source === 'modrinth') {
      if (!entry.projectId)
        throw new Error(`${entry.name}: source "modrinth" requires projectId or url`);
      // A pinned version is the pack author's explicit choice and is looked for
      // across every build; without one, the manifest's Minecraft version
      // decides, rather than whatever the project published most recently.
      const versions = await getModVersions(entry.projectId, entry.version ? undefined : mcVersion);
      const match = entry.version
        ? versions.find((v) => v.version_number === entry.version || v.id === entry.version)
        : versions[0];
      if (!match) {
        throw new Error(
          entry.version
            ? `${entry.name}: no Modrinth version matching "${entry.version}"`
            : `${entry.name}: no Modrinth build for MC ${mcVersion}`,
        );
      }
      const file = primaryFile(match);
      downloadUrl = file.url;
      fileName = file.filename;
      version = match.version_number || match.id;
    } else {
      throw new Error(`${entry.name}: source "${entry.source}" needs a url`);
    }

    const dest = path.join(dir, fileName);

    // Skip the download when the file on disk already matches the manifest.
    if (previous && (await fileMatches(dest, entry))) {
      fromManifest.push({ ...previous, fileName, version, fromManifest: true });
      continue;
    }

    log.info(`Syncing ${kind.slice(0, -1)}: ${entry.name}`);
    await downloadToFile(downloadUrl, dest);
    await verifyDownload(dest, entry, entry.name);
    const hash = await sha256File(dest);

    fromManifest.push({
      id: entry.id,
      name: entry.name,
      version,
      source: entry.source === 'modrinth' ? 'modrinth' : 'url',
      fileName,
      sha256: hash,
      required: true,
      side: 'client',
      enabled: true,
      fromManifest: true,
    });
  }

  // Drop manifest-managed items the manifest dropped.
  const keptIds = new Set(fromManifest.map((item) => item.id));
  for (const stale of existing.filter((i) => i.fromManifest && !keptIds.has(i.id))) {
    try {
      await fs.rm(path.join(dir, stale.fileName), { force: true });
    } catch {
      /* ok */
    }
    log.info(`Removed orphaned ${kind.slice(0, -1)} ${stale.name} from profile ${profileId}`);
  }

  await writeIndex(kind, profileId, [...fromManifest, ...userInstalled]);
  if (kind === 'resourcepacks') await syncResourcePackSelection(profileId);
  return fromManifest.length;
}

export async function removeContent(
  kind: ContentKind,
  profileId: string,
  id: string,
): Promise<void> {
  const dir = targetDir(kind, profileId);
  const items = await readIndex(kind, profileId);
  const item = items.find((m) => m.id === id);
  if (!item) throw new Error(`${kind.slice(0, -1)} ${id} not found`);

  try {
    await fs.rm(path.join(dir, item.fileName), { force: true });
  } catch {
    /* ok */
  }
  await writeIndex(
    kind,
    profileId,
    items.filter((m) => m.id !== id),
  );
  if (kind === 'resourcepacks') await syncResourcePackSelection(profileId);
  log.info(`Removed ${kind.slice(0, -1)} ${item.name} from profile ${profileId}`);
}

/**
 * Reorder resource packs — in the launcher's index *and* in the game's own
 * `options.txt`, which is the only one Minecraft actually reads.
 *
 * `orderedIds` is highest priority first, matching the UI's promise that the top
 * of the list wins. See `applyResourcePackOrder` for why that is reversed on the
 * way into the file.
 */
export async function reorderResourcePacks(profileId: string, orderedIds: string[]): Promise<void> {
  const items = await readIndex('resourcepacks', profileId);
  const byId = new Map(items.map((m) => [m.id, m]));
  const reordered = orderedIds
    .map((id) => byId.get(id))
    .filter((m): m is InstalledMod => Boolean(m));
  // Append any missing items at the end
  for (const item of items) {
    if (!orderedIds.includes(item.id)) reordered.push(item);
  }
  await writeIndex('resourcepacks', profileId, reordered);
  await syncResourcePackSelection(profileId);
  log.info(`Reordered ${reordered.length} resource packs for profile ${profileId}`);
}
