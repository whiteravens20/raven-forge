import fs from 'node:fs/promises';
import { log } from '../../main/logger';
import { paths } from './paths';
import { writeJsonAtomic } from '../util/atomic-file';
import { DEFAULT_SETTINGS } from './defaults';
import { globalSettingsSchema } from '../../shared/validators';
import type { GlobalSettings } from '../../shared/ipc-types';

let cachedSettings: GlobalSettings | null = null;

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
 */
export async function loadSettings(): Promise<GlobalSettings> {
  let raw: string;
  try {
    raw = await fs.readFile(paths.settings, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Unreadable is not the same as absent — a permissions problem must not
      // be answered by overwriting the file nobody could read.
      log.error(`Could not read ${paths.settings}:`, err);
      cachedSettings = { ...DEFAULT_SETTINGS };
      return cachedSettings;
    }
    cachedSettings = { ...DEFAULT_SETTINGS };
    await saveSettings(cachedSettings);
    return cachedSettings;
  }

  const parsed = globalSettingsSchema.safeParse(safeJsonParse(raw));
  if (parsed.success) {
    cachedSettings = parsed.data;
    return parsed.data;
  }

  const backup = `${paths.settings}.broken-${Date.now()}`;
  log.error(
    `${paths.settings} is not valid settings — keeping a copy at ${backup} and starting from ` +
      'the defaults. ' +
      parsed.error.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join('; '),
  );
  await fs.rename(paths.settings, backup).catch(() => undefined);

  cachedSettings = { ...DEFAULT_SETTINGS };
  await saveSettings(cachedSettings);
  return cachedSettings;
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
 * Save settings to disk.
 */
export async function saveSettings(settings: GlobalSettings): Promise<void> {
  await writeJsonAtomic(paths.settings, settings);
  cachedSettings = settings;
}

/**
 * Update partial settings and save.
 */
export async function updateSettings(updates: Partial<GlobalSettings>): Promise<GlobalSettings> {
  const current = cachedSettings ?? (await loadSettings());
  const merged = { ...current, ...updates };
  const validated = globalSettingsSchema.parse(merged);
  await saveSettings(validated);
  return validated;
}

/**
 * Reset settings to defaults.
 */
export async function resetSettings(): Promise<GlobalSettings> {
  const defaults = { ...DEFAULT_SETTINGS };
  await saveSettings(defaults);
  return defaults;
}

/**
 * Get cached settings (load if not yet loaded).
 */
export async function getSettings(): Promise<GlobalSettings> {
  if (cachedSettings) return cachedSettings;
  return loadSettings();
}
