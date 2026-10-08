// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { log } from '../../main/logger';
import { paths } from '../config/paths';
import { writeJsonAtomic } from '../util/atomic-file';
import { serializeByKey } from '../util/serialize';
import { getVersion, getModVersions, getProjectTitle, primaryFile } from './modrinth-api';
import { getProfile } from '../profiles/profile-manager';
import { downloadToFile } from '../net/download';
import { applyResourcePackOrder } from '../minecraft/options-file';
import { fileMatches, pinnedHashes, type HashedEntry } from './integrity';
import { isSameModFile } from './lock-file';
import type { ContentKind, InstalledMod } from '../../shared/ipc-types';
import {
  fileNameFromUrl,
  isSafeFileName,
  type ResourcePackEntry,
  type ShaderEntry,
} from '../../shared/manifest-schema';
import { RefusedError } from '../util/refusal';
import { isSameFile } from '../util/same-file';
import { STOP, eachEntry } from '../util/zip-read';

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
  // Outside the `try`, for the same reason as `readLockFile`: a missing file is
  // an ordinary empty state, an id that is not a path component is not.
  const file = indexPath(kind, profileId);
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8')) as InstalledMod[];
  } catch {
    return [];
  }
}

async function writeIndex(
  kind: ContentKind,
  profileId: string,
  items: InstalledMod[],
): Promise<void> {
  await writeJsonAtomic(indexPath(kind, profileId), items);
}

/**
 * Read one of these indexes, change it, and write it back with nothing in
 * between — the same guarantee `mutateLockFile` gives `installed.lock`.
 *
 * These files are written by the same overlapping paths: a manifest sync
 * reconciling the whole list while the player installs a pack from the browser.
 * Both used to read, download, and write the whole array back.
 */
function mutateIndex<T>(
  kind: ContentKind,
  profileId: string,
  mutate: (items: InstalledMod[]) => T | Promise<T>,
): Promise<T> {
  return serializeByKey(indexPath(kind, profileId), async () => {
    const items = await readIndex(kind, profileId);
    const result = await mutate(items);
    await writeIndex(kind, profileId, items);
    return result;
  });
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
    items.map((p) => p.fileName),
  );
}

/**
 * Install a shader or a resource pack from Modrinth: the newest build of the
 * project for the profile's Minecraft version.
 *
 * `versionId` overrides that choice, and is how an install the player accepted
 * a compatibility warning about gets the build the warning was about.
 */
export async function installContent(
  kind: ContentKind,
  profileId: string,
  projectId: string,
  versionId?: string,
): Promise<InstalledMod> {
  const dir = targetDir(kind, profileId);
  await fs.mkdir(dir, { recursive: true });

  // Pinned to the profile's Minecraft version. Taking whatever is newest — as
  // this did — puts a pack built for 1.21.8 into a 1.20.1 profile, where a
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

  const file = primaryFile(chosen);
  // The project's title, not the version's. `ModrinthVersion.name` is a build
  // label — Complementary Reimagined publishes its as `r5.8.1`, so the
  // installed list read "r5.8.1" where a pack name belonged.
  const name = await getProjectTitle(projectId);

  log.info(`Downloading ${kind.slice(0, -1)}: ${name}`);
  // Checked against the hash Modrinth publishes for this exact build, rather
  // than accepting whatever the CDN returned.
  await downloadToFile(file.url, path.join(dir, file.filename), {
    secure: true,
    verify: { hashes: { sha512: file.hashes.sha512, sha1: file.hashes.sha1 }, label: name },
  });

  const installed: InstalledMod = {
    id: projectId,
    name,
    version: chosen.version_number || chosen.id,
    source: 'modrinth',
    fileName: file.filename,
    enabled: true,
    fromManifest: false,
  };

  await mutateIndex(kind, profileId, async (items) => {
    const idx = items.findIndex((m) => m.id === installed.id);
    if (idx >= 0) {
      // The build this one replaces, unless it goes by the same file name — in
      // which case that name is the file that has just arrived, and deleting
      // "the old one" used to delete it.
      if (items[idx].fileName !== installed.fileName) {
        await fs.rm(path.join(dir, items[idx].fileName), { force: true });
      }
      items[idx] = installed;
    } else {
      items.push(installed);
    }
  });
  if (kind === 'resourcepacks') await syncResourcePackSelection(profileId);
  return installed;
}

/**
 * What makes an archive the kind of pack it is being added as, and the same
 * thing one folder down — which is what zipping the folder instead of what is
 * in it produces, and the usual reason a pack that "is there" never shows up.
 */
const PACK_LAYOUT: Record<ContentKind, { top: RegExp; nested: RegExp }> = {
  resourcepacks: { top: /^pack\.mcmeta$/, nested: /^([^/]+)\/pack\.mcmeta$/ },
  shaders: { top: /^shaders\//, nested: /^([^/]+)\/shaders\// },
};

/**
 * Refuse a file the game would not read as this kind of pack.
 *
 * Checked before anything is copied, because the failure it prevents is silent:
 * the zip sits in the folder, the launcher lists it, and the game shows nothing
 * — with no error anywhere, since to the game it is simply not a pack.
 */
async function assertPackLayout(kind: ContentKind, file: string): Promise<void> {
  const layout = PACK_LAYOUT[kind];
  const name = path.basename(file);
  let found = false;
  let nestedIn: string | undefined;
  try {
    await eachEntry(file, async (_zip, entry) => {
      if (layout.top.test(entry.fileName)) {
        found = true;
        return STOP;
      }
      nestedIn ??= layout.nested.exec(entry.fileName)?.[1];
    });
  } catch {
    throw new RefusedError({ key: 'contentError.notZip' }, `${name} is not a zip archive`);
  }
  if (found) return;

  const shaders = kind === 'shaders';
  if (nestedIn) {
    throw new RefusedError(
      {
        key: shaders ? 'contentError.nestedShaderPack' : 'contentError.nestedResourcePack',
        vars: { folder: nestedIn },
      },
      `${name} holds its pack inside the folder ${nestedIn}, not at the top level`,
    );
  }
  throw new RefusedError(
    { key: shaders ? 'contentError.notShaderPack' : 'contentError.notResourcePack' },
    `${name} is not a ${shaders ? 'shader' : 'resource'} pack`,
  );
}

/**
 * Add a shader or a resource pack the player already has as a file.
 *
 * Plenty of both are published only on their authors' own sites, or generated
 * to order, so Modrinth cannot be the one way in. Until this existed the route
 * was to open the profile folder and drop the zip there — which works for the
 * game, and leaves the launcher listing a profile that is not the one being
 * played: nothing to reorder, nothing to remove, nothing in an exported pack.
 *
 * The file is copied, never moved: it is the player's, and stays where it was.
 */
export async function addContentFromFile(
  kind: ContentKind,
  profileId: string,
  filePath: string,
): Promise<InstalledMod> {
  const dir = targetDir(kind, profileId);
  if (!(await getProfile(profileId))) throw new Error(`Profile ${profileId} not found`);
  const fileName = path.basename(filePath);
  if (!/\.zip$/i.test(fileName) || !isSafeFileName(fileName)) {
    throw new RefusedError({ key: 'contentError.notZip' }, `${fileName} is not a zip archive`);
  }
  await assertPackLayout(kind, filePath);
  await fs.mkdir(dir, { recursive: true });
  const dest = path.join(dir, fileName);

  const added = await mutateIndex(kind, profileId, async (items) => {
    const idx = items.findIndex((item) => isSameModFile(item.fileName, fileName));
    const existing = idx >= 0 ? items[idx] : undefined;
    if (existing?.fromManifest) {
      throw new RefusedError(
        { key: 'contentError.ownedByPack', vars: { name: existing.fileName } },
        `${existing.fileName} belongs to the pack this profile follows`,
      );
    }

    // A pack already in this folder is listed where it lies. That is how one
    // dropped here by hand gets onto the list, and copying a file onto itself
    // would empty it.
    if (!(await isSameFile(filePath, dest))) {
      if (existing && existing.fileName !== fileName) {
        const previous = path.join(dir, existing.fileName);
        if (!(await isSameFile(filePath, previous))) await fs.rm(previous, { force: true });
      }
      // Beside its name and then renamed onto it, so a copy that stops half-way
      // — a full disk, a stick pulled out — leaves no half of a pack behind.
      const part = `${dest}.part`;
      try {
        await fs.copyFile(filePath, part);
        await fs.rename(part, dest);
      } catch (err) {
        await fs.rm(part, { force: true });
        throw err;
      }
    }

    const installed: InstalledMod = {
      // The same entry when it is a newer copy of a file added before, so it
      // keeps its place in the order.
      id: existing?.source === 'local' ? existing.id : `local-${crypto.randomUUID()}`,
      name: fileName.replace(/\.zip$/i, ''),
      version: 'local',
      source: 'local',
      fileName,
      enabled: true,
      fromManifest: false,
    };
    if (idx >= 0) items[idx] = installed;
    else items.push(installed);
    return installed;
  });

  if (kind === 'resourcepacks') await syncResourcePackSelection(profileId);
  log.info(`Added ${kind === 'shaders' ? 'shader' : 'resource'} pack from a file: ${fileName}`);
  return added;
}

/**
 * Reconcile a profile's shaders / resource packs against a server manifest.
 *
 * Entries already present with a matching hash are left alone. Items
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
  const fromManifest: InstalledMod[] = [];
  /** Files of entries that now go by another file name — the builds they replaced. */
  const replaced: string[] = [];

  for (const entry of entries) {
    const previous = existing.find((item) => item.id === entry.id);

    let downloadUrl: string;
    let fileName: string;
    let version = entry.version ?? 'unknown';
    // Modrinth's published hash for the resolved build, which is what an entry
    // that declared none of its own is held to.
    let apiHashes: HashedEntry | undefined;

    if (entry.url) {
      // Direct URL — no API lookup needed, whatever the declared source is.
      // The schema has already rejected a `fileName` carrying a path, so this
      // cannot leave the shaders / resource-packs directory.
      downloadUrl = entry.url;
      fileName = entry.fileName ?? fileNameFromUrl(entry.url, entry.id, '.zip');
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
      apiHashes = { sha512: file.hashes.sha512, sha1: file.hashes.sha1 };
    } else {
      throw new Error(`${entry.name}: source "${entry.source}" needs a url`);
    }

    const dest = path.join(dir, fileName);
    if (previous && previous.fileName !== fileName) replaced.push(previous.fileName);

    // One answer to "what should this file hash to", for looking at the copy
    // on disk and for checking what arrives. The two used to disagree: the copy
    // was held to the manifest's hash alone, so an entry with none was fetched
    // again at every sync, and the download to both at once — see
    // `pinnedHashes`.
    const hashes = pinnedHashes(entry, apiHashes);

    // Skip the download when the file on disk is already that file.
    if (previous && (await fileMatches(dest, hashes))) {
      fromManifest.push({
        ...previous,
        projectId: entry.projectId,
        fileName,
        version,
        fromManifest: true,
      });
      continue;
    }

    log.info(`Syncing ${kind.slice(0, -1)}: ${entry.name}`);
    await downloadToFile(downloadUrl, dest, {
      secure: true,
      verify: { hashes, label: entry.name },
    });

    fromManifest.push({
      id: entry.id,
      projectId: entry.projectId,
      name: entry.name,
      version,
      source: entry.source === 'modrinth' ? 'modrinth' : 'url',
      fileName,
      enabled: true,
      fromManifest: true,
    });
  }

  // A version bump changes the file name, and the build it replaced has to go
  // with it. The mods path has always done this; here the old zip stayed in the
  // folder beside the new one, listed nowhere, until somebody found it. Only
  // once everything has arrived, and never a file another entry now goes by.
  const inUse = new Set(fromManifest.map((item) => item.fileName));
  for (const fileName of replaced) {
    if (!inUse.has(fileName)) await fs.rm(path.join(dir, fileName), { force: true });
  }

  // Drop manifest-managed items the manifest dropped.
  const keptIds = new Set(fromManifest.map((item) => item.id));
  for (const stale of existing.filter((i) => i.fromManifest && !keptIds.has(i.id))) {
    await fs.rm(path.join(dir, stale.fileName), { force: true });
    log.info(`Removed orphaned ${kind.slice(0, -1)} ${stale.name} from profile ${profileId}`);
  }

  // Read again under the lock rather than reusing `userInstalled`, which was
  // taken before the downloads: only the manifest's half of this index is this
  // function's to replace, and a pack installed by hand in the meantime belongs
  // to the other half.
  await mutateIndex(kind, profileId, (items) => {
    const stillUserInstalled = items.filter((item) => !item.fromManifest);
    items.splice(0, items.length, ...fromManifest, ...stillUserInstalled);
  });
  if (kind === 'resourcepacks') await syncResourcePackSelection(profileId);
  return fromManifest.length;
}

export async function removeContent(
  kind: ContentKind,
  profileId: string,
  id: string,
): Promise<void> {
  const dir = targetDir(kind, profileId);
  const name = await mutateIndex(kind, profileId, async (items) => {
    const idx = items.findIndex((m) => m.id === id);
    if (idx < 0) throw new Error(`${kind.slice(0, -1)} ${id} not found`);
    const item = items[idx];

    // Before the entry, and not past a failure: a file that would not go —
    // held open by a running game on Windows — used to leave the list saying it
    // had gone, with nothing left in the launcher to remove it by.
    await fs.rm(path.join(dir, item.fileName), { force: true });
    items.splice(idx, 1);
    return item.name;
  });
  if (kind === 'resourcepacks') await syncResourcePackSelection(profileId);
  log.info(`Removed ${kind.slice(0, -1)} ${name} from profile ${profileId}`);
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
  const count = await mutateIndex('resourcepacks', profileId, (items) => {
    const byId = new Map(items.map((m) => [m.id, m]));
    const reordered = orderedIds
      .map((id) => byId.get(id))
      .filter((m): m is InstalledMod => Boolean(m));
    // Append any missing items at the end
    for (const item of items) {
      if (!orderedIds.includes(item.id)) reordered.push(item);
    }
    items.splice(0, items.length, ...reordered);
    return reordered.length;
  });
  await syncResourcePackSelection(profileId);
  log.info(`Reordered ${count} resource packs for profile ${profileId}`);
}
