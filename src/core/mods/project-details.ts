// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from '../../main/logger';
import { paths } from '../config/paths';
import { writeJsonAtomic } from '../util/atomic-file';
import { serializeByKey } from '../util/serialize';
import { getProjects } from './modrinth-api';
import type { ProjectDetails } from '../../shared/ipc-types';
import { errorText } from '../util/error-text';

/**
 * What a mod is, for the list of the ones a profile has.
 *
 * The installed list knew a mod's name, version and file, and nothing a person
 * would recognise it by: a pack of two hundred mods was two hundred names with
 * no way to tell what any of them does or where it came from. The description,
 * the icon and the address of the project page are Modrinth's to give.
 *
 * Remembered on disk, because the answer does not change from one day to the
 * next and the list is opened far more often than it is edited — and because a
 * list that has been seen once should still read the same with the network
 * gone. A name Modrinth does not know is remembered too, for a shorter time, so
 * a jar built at home is not asked about on every visit.
 */

const CACHE_FILE = 'modrinth-projects.json';

/** How long a description is taken as current. */
const FRESH_MS = 7 * 24 * 60 * 60 * 1000;
/** How long "Modrinth has nothing by this name" is — shorter, since projects do get published. */
const MISSING_FRESH_MS = 24 * 60 * 60 * 1000;

/**
 * What can be a Modrinth id or slug at all. Anything else — a path, a hash of a
 * file's contents — is not sent anywhere.
 */
const PROJECT_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;
/** The stand-in id an `.mrpack` entry gets when it is not a Modrinth download. */
const HASH_PREFIX = /^[0-9a-f]{32}$/;

interface CacheEntry {
  /** `null` when Modrinth had no project by this name. */
  details: ProjectDetails | null;
  at: number;
}

type Cache = Record<string, CacheEntry>;

let cache: Cache | null = null;

function cacheFile(): string {
  return path.join(paths.cacheDir, CACHE_FILE);
}

async function loadCache(): Promise<Cache> {
  if (cache) return cache;
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(cacheFile(), 'utf-8'));
    cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Cache) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function isFresh(entry: CacheEntry | undefined, now: number): boolean {
  if (!entry) return false;
  return now - entry.at < (entry.details ? FRESH_MS : MISSING_FRESH_MS);
}

/** Whether a name is worth asking Modrinth about. */
export function isProjectKey(key: unknown): key is string {
  return typeof key === 'string' && PROJECT_KEY.test(key) && !HASH_PREFIX.test(key);
}

/**
 * Details for each of these ids or slugs that Modrinth knows, keyed as asked.
 *
 * Never throws for the network's sake: a lookup that fails returns whatever is
 * remembered, stale or not, because a description from last month is a better
 * answer to "what is this mod" than none.
 */
export async function getProjectDetails(keys: string[]): Promise<Record<string, ProjectDetails>> {
  const wanted = [...new Set(keys.filter(isProjectKey))];
  const known = await loadCache();
  const now = Date.now();

  const missing = wanted.filter((key) => !isFresh(known[key], now));
  if (missing.length > 0) {
    try {
      const projects = await getProjects(missing);
      for (const key of missing) {
        // A key is whichever of the two the caller happened to hold: an id is
        // matched exactly, a slug without regard to case, as Modrinth does.
        const project = projects.find(
          (p) => p.id === key || p.slug.toLowerCase() === key.toLowerCase(),
        );
        known[key] = {
          at: now,
          details: project
            ? {
                slug: project.slug,
                description: project.description,
                iconUrl: project.icon_url ?? undefined,
              }
            : null,
        };
      }
      // One writer at a time; two lists opened together would otherwise race
      // each other to the same file.
      await serializeByKey(CACHE_FILE, () => writeJsonAtomic(cacheFile(), known));
    } catch (err) {
      log.warn(`Could not look up ${missing.length} project(s) on Modrinth: ${errorText(err)}`);
    }
  }

  const found: Record<string, ProjectDetails> = {};
  for (const key of wanted) {
    const details = known[key]?.details;
    if (details) found[key] = details;
  }
  return found;
}
