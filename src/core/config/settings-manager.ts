// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import { app } from 'electron';
import { log } from '../../main/logger';
import { paths } from './paths';
import { OWNER_ONLY, keepToOwner, writeJsonAtomic } from '../util/atomic-file';
import { serializeByKey } from '../util/serialize';
import { DEFAULT_SETTINGS } from './defaults';
import { globalSettingsSchema } from '../../shared/validators';
import { pickLocale } from '../../shared/locale';
import type { GlobalSettings } from '../../shared/ipc-types';

let cachedSettings: GlobalSettings | null = null;

/**
 * True while `cachedSettings` is the defaults standing in for a file that is
 * there and could not be read. Nothing is saved from that state: see
 * `changeSettings`.
 */
let standingIn = false;

/**
 * What a launcher with nothing saved starts from: the defaults, in the system's
 * language. A language somebody has saved is never replaced by this, whatever
 * the system says, so a new build does not change it under anyone.
 */
function freshSettings(): GlobalSettings {
  return { ...DEFAULT_SETTINGS, language: pickLocale(app.getPreferredSystemLanguages()) };
}

/**
 * Load settings from disk.
 *
 * A missing file is a first launch and gets the defaults written out. Anything
 * *else* — unparseable JSON, a shape the schema rejects — is treated as a fault
 * worth keeping the evidence of, because this used to catch every failure alike
 * and immediately write `DEFAULT_SETTINGS` over the file it had just failed to
 * read. One unrecognised field, from a hand-edit or from a newer build's
 * settings, silently destroyed the user's theme, feed URLs, proxy and trusted
 * keys, and the only trace was that everything had gone back to normal.
 *
 * The broken file is moved aside rather than deleted, so it can be read back
 * and the settings recovered by hand.
 *
 * A file that cannot be read at all — a permissions problem, a share that is
 * not answering — is left exactly as it is, and the launcher runs on the
 * defaults until it can be.
 */
export async function loadSettings(): Promise<GlobalSettings> {
  try {
    cachedSettings = await readSettingsFile();
    standingIn = false;
  } catch (err) {
    log.error(`Could not read ${paths.settings}:`, err);
    cachedSettings = freshSettings();
    standingIn = true;
  }
  return cachedSettings;
}

/** What the file holds. Throws when it is there and cannot be read. */
async function readSettingsFile(): Promise<GlobalSettings> {
  let raw: string;
  try {
    raw = await fs.readFile(paths.settings, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    const defaults = freshSettings();
    await writeJsonAtomic(paths.settings, defaults, OWNER_ONLY);
    return defaults;
  }
  // A proxy's password can be in here. Closed before anything else is done
  // with it, so a copy kept of a file that will not parse is closed too.
  await keepToOwner(paths.settings);

  const parsed = globalSettingsSchema.safeParse(safeJsonParse(raw));
  if (parsed.success) return parsed.data;

  const backup = `${paths.settings}.broken-${Date.now()}`;
  log.error(
    `${paths.settings} is not valid settings — keeping a copy at ${backup} and starting from ` +
      'the defaults. ' +
      parsed.error.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join('; '),
  );
  await fs.rename(paths.settings, backup).catch(() => undefined);

  const defaults = freshSettings();
  await writeJsonAtomic(paths.settings, defaults, OWNER_ONLY);
  return defaults;
}

/** `null` on malformed JSON, which the schema then rejects like any other value. */
function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Read the settings, change them, and write them back with nothing in between.
 *
 * Changes take turns. Each is a read, a merge and a write with an `await` in
 * the middle, and unqueued they all merged into the same starting point: the
 * one that finished last erased the others, after each had been answered as
 * saved.
 *
 * A change is built on what the file holds. After a start that could not read
 * it, what is cached is the defaults standing in — so the file is read again
 * here, and a change is refused for as long as that fails. Saving would have
 * put the defaults, plus the one thing just changed, over a proxy, a theme and
 * a list of trusted keys that nobody had read, with no copy kept.
 */
function changeSettings(
  change: (current: GlobalSettings) => GlobalSettings,
): Promise<GlobalSettings> {
  return serializeByKey(paths.settings, async () => {
    const current = cachedSettings && !standingIn ? cachedSettings : await readSettingsFile();
    const next = globalSettingsSchema.parse(change(current));
    await writeJsonAtomic(paths.settings, next, OWNER_ONLY);
    cachedSettings = next;
    standingIn = false;
    return next;
  });
}

/**
 * Update partial settings and save.
 */
export function updateSettings(updates: Partial<GlobalSettings>): Promise<GlobalSettings> {
  return changeSettings((current) => ({ ...current, ...updates }));
}

/**
 * Reset settings to defaults.
 */
export function resetSettings(): Promise<GlobalSettings> {
  return changeSettings(() => freshSettings());
}

/**
 * Get cached settings (load if not yet loaded).
 */
export async function getSettings(): Promise<GlobalSettings> {
  if (cachedSettings) return cachedSettings;
  return loadSettings();
}
