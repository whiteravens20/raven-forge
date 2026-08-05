import fs from 'node:fs/promises';
import path from 'node:path';
import { paths } from './paths';
import { DEFAULT_SETTINGS } from './defaults';
import { globalSettingsSchema } from '../../shared/validators';
import type { GlobalSettings } from '../../shared/ipc-types';

let cachedSettings: GlobalSettings | null = null;

/**
 * Load settings from disk. Returns defaults if file doesn't exist.
 */
export async function loadSettings(): Promise<GlobalSettings> {
  try {
    const raw = await fs.readFile(paths.settings, 'utf-8');
    const parsed = JSON.parse(raw);
    const validated = globalSettingsSchema.parse(parsed);
    cachedSettings = validated;
    return validated;
  } catch {
    // File missing or invalid — use defaults
    cachedSettings = { ...DEFAULT_SETTINGS };
    await saveSettings(cachedSettings);
    return cachedSettings;
  }
}

/**
 * Save settings to disk.
 */
export async function saveSettings(settings: GlobalSettings): Promise<void> {
  const json = JSON.stringify(settings, null, 2);
  await fs.mkdir(path.dirname(paths.settings), { recursive: true });
  await fs.writeFile(paths.settings, json, 'utf-8');
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
