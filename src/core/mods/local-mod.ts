// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from '../../main/logger';
import { paths } from '../config/paths';
import { getProfile } from '../profiles/profile-manager';
import { errorText } from '../util/error-text';
import { RefusedError } from '../util/refusal';
import { eachEntry } from '../util/zip-read';
import { isSameFile } from '../util/same-file';
import { isSafeFileName } from '../../shared/manifest-schema';
import { isProject } from '../../shared/mod-identity';
import { loaderLabel } from '../../shared/labels';
import type { InstalledMod, ModAddition, ModLoaderType } from '../../shared/ipc-types';
import { hashFile } from './integrity';
import { isSameModFile, modFilePath, mutateLockFile } from './lock-file';
import { installRequiredDependencies } from './mod-sync';
import { getProjectTitle, versionsByHash, type ModrinthVersion } from './modrinth-api';

/**
 * Adding a mod the player already has as a file.
 *
 * Not everything is on Modrinth: a mod published only elsewhere, a build an
 * author handed out, one compiled at home. The way in used to be the profile
 * folder, which the game is happy with and the launcher knew nothing about — a
 * jar dropped there could not be switched off, removed, updated or exported
 * from the list, because it was not on it.
 */

/** The file each loader reads to find out what a jar is, and whose it is. */
const LOADER_MARKERS: Record<string, ModLoaderType> = {
  'fabric.mod.json': 'fabric',
  'quilt.mod.json': 'quilt',
  'META-INF/mods.toml': 'forge',
  'META-INF/neoforge.mods.toml': 'neoforge',
  // Forge up to 1.12.
  'mcmod.info': 'forge',
};

/**
 * Which of those files a profile's loader reads.
 *
 * Wider than the loader's own in two places, both true of the loaders
 * themselves: Quilt loads Fabric mods, and NeoForge read Forge's `mods.toml`
 * for as long as the two were one project.
 */
const READS: Record<ModLoaderType, ModLoaderType[]> = {
  vanilla: [],
  fabric: ['fabric'],
  quilt: ['quilt', 'fabric'],
  forge: ['forge'],
  neoforge: ['neoforge', 'forge'],
};

/** The loaders a jar says it is for. Empty when it says nothing either way. */
async function loadersOf(file: string): Promise<ModLoaderType[]> {
  const found = new Set<ModLoaderType>();
  await eachEntry(file, async (_zip, entry) => {
    const loader = LOADER_MARKERS[entry.fileName];
    if (loader) found.add(loader);
  });
  return [...found];
}

/**
 * Which Modrinth build this file is, when it is one.
 *
 * The same bytes Modrinth serves are the same mod, however they got here — and
 * knowing which makes the entry an ordinary one: its updates are found, what it
 * needs is fetched, and a mod that requires it later sees that it is there.
 *
 * Unknown is an answer and so is unreachable: a private build has no page, and
 * a file can be added with no network at all. Both are simply a local file.
 */
async function identify(file: string): Promise<ModrinthVersion | undefined> {
  try {
    const hash = await hashFile(file, 'sha512');
    return (await versionsByHash([hash])).get(hash);
  } catch (err) {
    log.warn(`Could not ask Modrinth what ${path.basename(file)} is: ${errorText(err)}`);
    return undefined;
  }
}

export async function addModFromFile(profileId: string, filePath: string): Promise<ModAddition> {
  const modsDir = paths.profileModsDir(profileId);
  const profile = await getProfile(profileId);
  if (!profile) throw new Error(`Profile ${profileId} not found`);

  const fileName = path.basename(filePath);
  const notJar = () =>
    new RefusedError({ key: 'contentError.notJar' }, `${fileName} is not a mod's jar file`);
  if (!/\.jar$/i.test(fileName) || !isSafeFileName(fileName)) throw notJar();

  if (profile.modLoader === 'vanilla') {
    throw new RefusedError(
      { key: 'contentError.needsLoader' },
      'A profile with no mod loader has nothing to read a mod with',
    );
  }

  let madeFor: ModLoaderType[];
  try {
    madeFor = await loadersOf(filePath);
  } catch {
    throw notJar();
  }
  // Only when the jar says whose it is and that is nobody this profile runs. A
  // jar that says nothing is let through: plenty of working mods are older
  // than these files, and a guess here would be a refusal of something fine.
  if (madeFor.length > 0 && !madeFor.some((loader) => READS[profile.modLoader].includes(loader))) {
    throw new RefusedError(
      {
        key: 'contentError.wrongLoader',
        vars: {
          made: madeFor.map(loaderLabel).join(', '),
          profile: loaderLabel(profile.modLoader),
        },
      },
      `${fileName} is made for ${madeFor.join(', ')}, and the profile runs ${profile.modLoader}`,
    );
  }

  const known = await identify(filePath);
  const name = known
    ? await getProjectTitle(known.project_id).catch(() => fileName.replace(/\.jar$/i, ''))
    : fileName.replace(/\.jar$/i, '');

  await fs.mkdir(modsDir, { recursive: true });
  const mod = await mutateLockFile(profileId, async (mods) => {
    // The entry this stands in for: a file of the same name, or another build
    // of the same project — two of those in one folder and the loader stops
    // at "duplicate mod" before the game has drawn anything.
    const idx = mods.findIndex(
      (m) =>
        isSameModFile(m.fileName, fileName) || (known && isProject(m, known.project_id)) || false,
    );
    const existing = idx >= 0 ? mods[idx] : undefined;
    if (existing?.fromManifest) {
      throw new RefusedError(
        { key: 'contentError.ownedByPack', vars: { name: existing.name } },
        `${existing.name} belongs to the pack this profile follows`,
      );
    }

    // Switched off stays switched off: a newer copy of a mod the player turned
    // off is not a decision to turn it on again.
    const enabled = existing?.enabled ?? true;
    const dest = modFilePath(modsDir, fileName, enabled);

    // A jar already lying where it would go is listed as it lies. That is how
    // one dropped into the folder by hand gets onto the list, and copying a
    // file onto itself would empty it.
    if (!(await isSameFile(filePath, dest))) {
      if (existing) {
        const previous = modFilePath(modsDir, existing.fileName, existing.enabled);
        if (previous !== dest && !(await isSameFile(filePath, previous))) {
          await fs.rm(previous, { force: true });
        }
      }
      // Beside its name and renamed onto it, so a copy that stops half-way
      // leaves no half of a jar for the loader to choke on.
      const part = `${dest}.part`;
      try {
        await fs.copyFile(filePath, part);
        await fs.rename(part, dest);
      } catch (err) {
        await fs.rm(part, { force: true });
        throw err;
      }
    }

    const added: InstalledMod = known
      ? {
          id: known.project_id,
          name,
          version: known.version_number || known.id,
          source: 'modrinth',
          fileName,
          enabled,
          fromManifest: false,
        }
      : {
          // The same entry when it is a newer copy of a file added before.
          id: existing?.source === 'local' ? existing.id : `local-${crypto.randomUUID()}`,
          name,
          version: 'local',
          source: 'local',
          fileName,
          enabled,
          fromManifest: false,
        };
    if (idx >= 0) mods[idx] = added;
    else mods.push(added);
    return added;
  });
  log.info(`Added mod ${mod.name} to profile ${profileId} from a file (${fileName})`);

  // What it cannot start without, when Modrinth says what that is — the same
  // as for a mod picked out of the search, and for the same reason.
  const dependencies = known ? await installRequiredDependencies(profileId, known) : [];
  return { name: mod.name, dependencies };
}
