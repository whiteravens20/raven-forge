// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import {
  DIR_CACHE,
  DIR_JAVA,
  DIR_LOADERS,
  FILE_AUTH,
  FILE_PROFILES,
  FILE_SETTINGS,
  LEGACY_HOME_DIR_NAME,
} from '../../shared/constants';
import { countSecrets } from '../auth/secret-store';
import { directorySize } from '../profiles/profile-manager';
import { updaterCacheDir } from '../updater/update-cache';
import { dataRootPointerFile } from './data-root';
import { paths } from './paths';
import type { StorageEntry, StorageId, StorageReport } from '../../shared/ipc-types';

/**
 * Every place on this computer the launcher writes to, measured.
 *
 * The privacy page used to say "all of it sits in one folder" and show one
 * path. That was a sentence about a default install on the day it was written:
 * with the data moved it was false about the log, the crash reports and the
 * browser's files, and it never mentioned the update download or the sign-in
 * kept by the operating system at all. Somebody who wants to know what a
 * program has put on their disk is owed the list, with sizes, taken from the
 * disk as it is now — so this is built from the same path functions the rest
 * of the launcher writes through, and a place added there without being added
 * here is the kind of omission a reader can at least catch.
 */

/**
 * Where the program itself is. An AppImage is one file that mounts itself
 * somewhere temporary, so the file is the honest answer there.
 */
function programLocation(): string {
  if (process.env.APPIMAGE) return process.env.APPIMAGE;
  return app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath();
}

/** Bytes at `target`, file or directory, or null when nothing is there. */
async function sizeOf(target: string): Promise<number | null> {
  try {
    const stat = await fs.stat(target);
    return stat.isDirectory() ? await directorySize(target) : stat.size;
  } catch {
    return null;
  }
}

async function sizeOfAll(targets: string[]): Promise<number | null> {
  const sizes = (await Promise.all(targets.map(sizeOf))).filter((s): s is number => s !== null);
  return sizes.length === 0 ? null : sizes.reduce((sum, size) => sum + size, 0);
}

export async function measureStorage(): Promise<StorageReport> {
  const root = paths.root;
  const home = paths.home;
  const legacyHome = path.join(app.getPath('appData'), LEGACY_HOME_DIR_NAME);

  const place = async (
    id: StorageId,
    where: StorageEntry['where'],
    target: string,
    measured?: Promise<number | null>,
  ): Promise<StorageEntry> => ({
    id,
    where,
    path: target,
    bytes: await (measured ?? sizeOf(target)),
    openable: paths.isInsideLauncherData(target),
  });

  const entries = await Promise.all([
    place('profiles', 'data', paths.profilesDir),
    place('gameFiles', 'data', path.join(root, DIR_CACHE)),
    place('java', 'data', path.join(root, DIR_JAVA)),
    place('loaders', 'data', path.join(root, DIR_LOADERS)),
    // Three small files, shown as one line and opened as the folder they are in.
    place(
      'state',
      'data',
      root,
      sizeOfAll([FILE_SETTINGS, FILE_PROFILES, FILE_AUTH].map((name) => path.join(root, name))),
    ),
    place('logs', 'data', paths.logsDir),
    place('crashReports', 'data', paths.crashReportsDir),
    place('browser', 'home', paths.browserDir),
    place('pointer', 'home', dataRootPointerFile()),
    place('updateCache', 'system', updaterCacheDir()),
    place('program', 'system', programLocation()),
    place('legacyHome', 'system', legacyHome),
  ]);

  return {
    root,
    home,
    // Nothing to say about a place that is not there — except the data's own
    // folders, which are listed empty rather than left out, since that is where
    // things will appear. The old-named home is only worth a line when it is
    // not the home in use.
    entries: entries.filter(
      (entry) =>
        (entry.bytes !== null || entry.where === 'data') &&
        !(entry.id === 'legacyHome' && path.resolve(entry.path) === path.resolve(home)),
    ),
    keychain: {
      platform:
        process.platform === 'win32' || process.platform === 'darwin' ? process.platform : 'linux',
      secrets: await countSecrets(),
    },
  };
}
