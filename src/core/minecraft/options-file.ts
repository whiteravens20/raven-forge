// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * The three lines of `options.txt` this launcher writes.
 *
 * Installing a resource pack into `resourcepacks/` does not enable it — the
 * game only loads what `resourcePacks` names, which is why a synced pack used
 * to sit in the folder doing nothing until the player enabled it by hand.
 *
 * `fullscreen` is here rather than on the command line because the command line
 * only goes one way. `--fullscreen` turns it on and the game then saves that
 * choice into this file; there is no `--windowed` to turn it back off, so a
 * profile switched back would have started full-screen for ever, and the
 * setting would have looked broken to the one person who tried both.
 *
 * `lang` has no command-line form at all; this file is the only place the game
 * reads its language from.
 */
const RESOURCE_PACKS_KEY = 'resourcePacks';
const FULLSCREEN_KEY = 'fullscreen';
const LANGUAGE_KEY = 'lang';

/**
 * How a pack from the `resourcepacks/` folder is named in the list.
 *
 * Modern Minecraft (1.13+) prefixes folder packs with `file/`; the launcher
 * targets that era. A 1.8-vintage profile would want the bare file name, which
 * is why {@link isFolderPack} recognises both when reading an existing line —
 * writing the wrong form loses the selection, it does not corrupt anything.
 */
function packEntry(fileName: string): string {
  return `file/${fileName}`;
}

/**
 * True when `entry` names a pack from the profile's `resourcepacks/` folder,
 * which is the launcher's territory to decide about.
 *
 * The folder is created and filled by the launcher, and the content page is how
 * packs get in and out of it, so its list is the source of truth for the packs
 * it put there. Anything else in the line — `vanilla`, `mod_resources`, a
 * namespaced pack a mod contributes — belongs to the game or a mod and is
 * copied through untouched.
 */
function isFolderPack(entry: string): boolean {
  return entry.startsWith('file/') || entry.toLowerCase().endsWith('.zip');
}

/** The file a folder entry names: `file/Faithful.zip` and `Faithful.zip` alike. */
function folderPackName(entry: string): string {
  return entry.startsWith('file/') ? entry.slice('file/'.length) : entry;
}

/**
 * Rebuild the `resourcePacks` value.
 *
 * **Two orders are involved and swapping them silently swaps which pack wins.**
 * Minecraft's selected list applies bottom-up — the wiki's words: "the
 * bottom-most pack loads first, then each pack above it replaces or merges
 * loaded assets with ones it contains" — and `options.txt` stores that *loading*
 * order, so the lowest-priority pack comes first and the last entry wins. It is
 * why `"vanilla"` heads the line in every real file: it is the base everything
 * else overrides. The launcher's own list runs the other way (index 0 is the top
 * of the UI and wins), so it is reversed on the way out.
 *
 * Entries that are not folder packs — `vanilla`, `mod_resources`, a mod's
 * built-in pack — are kept in their existing order and stay below the managed
 * ones. Dropping them would silently unselect a modpack's own resources. See
 * {@link isFolderPack} for where that line is drawn.
 *
 * So is a pack in the folder that the launcher did not put there: a zip the
 * player dropped in and switched on in the game, or one a `.mrpack` carried in
 * its overrides and selected in the `options.txt` it shipped. This runs at the
 * end of every sync, which for a pack profile is every launch, and it used to
 * take every folder entry it did not know out of the line — so such a pack was
 * switched off again each time the game started. `handPlaced` names the ones
 * that are really in the folder; an entry for a file that is gone still goes,
 * which is what keeps a pack removed in the launcher from staying listed.
 *
 * @param existing the current value, e.g. `["vanilla","mod_resources"]`, or null
 * @param orderedFileNames pack file names, highest priority first
 * @param handPlaced files in the folder that are not in the launcher's list
 */
export function buildResourcePacksValue(
  existing: string | null,
  orderedFileNames: string[],
  handPlaced: ReadonlySet<string> = new Set(),
): string {
  let foreign: string[] = [];
  if (existing) {
    try {
      const parsed: unknown = JSON.parse(existing);
      if (Array.isArray(parsed)) {
        foreign = parsed
          .filter((e): e is string => typeof e === 'string')
          .filter((e) => !isFolderPack(e) || handPlaced.has(folderPackName(e)));
      }
    } catch {
      // A line we cannot parse is a line we must not silently discard the
      // meaning of — but we also cannot merge into it. Start from vanilla.
      foreign = ['vanilla'];
    }
  } else {
    foreign = ['vanilla'];
  }

  const ours = [...orderedFileNames].reverse().map(packEntry);
  return JSON.stringify([...foreign, ...ours]);
}

/** Extract the raw value of `key` from an options.txt body, or null. */
function readOption(body: string, key: string): string | null {
  for (const line of body.split('\n')) {
    if (line.startsWith(`${key}:`)) return line.slice(key.length + 1).trimEnd();
  }
  return null;
}

/** Replace `key`'s line, or append it when the file does not have one yet. */
function writeOption(body: string, key: string, value: string): string {
  const lines = body.split('\n');
  const index = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (index >= 0) {
    lines[index] = `${key}:${value}`;
    return lines.join('\n');
  }
  const trimmed = body.endsWith('\n') ? body.slice(0, -1) : body;
  return trimmed === '' ? `${key}:${value}\n` : `${trimmed}\n${key}:${value}\n`;
}

/**
 * Read the profile's `options.txt`, change it, and write it back.
 *
 * The file belongs to the player, not to the launcher: every other setting is
 * copied through untouched, and the write goes to a temporary file first so a
 * crash mid-write cannot leave them with a truncated settings file. A profile
 * that has never been launched has no `options.txt` yet — one is created with
 * just the line being set, and Minecraft fills in the rest at its first save.
 */
async function editOptions(gameDir: string, edit: (body: string) => string): Promise<void> {
  const file = path.join(gameDir, 'options.txt');

  let body = '';
  try {
    body = await fs.readFile(file, 'utf-8');
  } catch {
    /* never launched — a one-line file is a valid options.txt */
  }

  const next = edit(body);
  if (next === body) return;

  await fs.mkdir(gameDir, { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, next, 'utf-8');
  await fs.rename(tmp, file);
}

/**
 * Point the profile's `options.txt` at these packs, in this order.
 *
 * @param orderedFileNames pack file names, highest priority first
 * @param managedFileNames every pack the launcher's list holds, switched on or
 *        not — whatever else is in `resourcepacks/` is the player's own, and
 *        its place in the line is left as the game wrote it
 */
export async function applyResourcePackOrder(
  gameDir: string,
  orderedFileNames: string[],
  managedFileNames: string[] = orderedFileNames,
): Promise<void> {
  const managed = new Set(managedFileNames);
  const inFolder = await fs.readdir(path.join(gameDir, 'resourcepacks')).catch(() => []);
  const handPlaced = new Set(inFolder.filter((name) => !managed.has(name)));

  await editOptions(gameDir, (body) =>
    writeOption(
      body,
      RESOURCE_PACKS_KEY,
      buildResourcePacksValue(readOption(body, RESOURCE_PACKS_KEY), orderedFileNames, handPlaced),
    ),
  );
}

/**
 * State the profile's full-screen choice in the file the game reads it from.
 *
 * Called on every launch, so the profile's answer wins over whatever the last
 * session left behind — which is the whole point: F11 during play writes
 * `fullscreen:true` here on exit, and a profile that says "windowed" has to be
 * able to mean it a second time. A profile that says nothing is left alone, so
 * the game's own memory of what the player last did survives.
 */
export async function applyFullscreen(gameDir: string, fullscreen: boolean): Promise<void> {
  await editOptions(gameDir, (body) => writeOption(body, FULLSCREEN_KEY, String(fullscreen)));
}

/**
 * State the profile's language in the file the game reads it from.
 *
 * The same contract as {@link applyFullscreen}: called on every launch for a
 * profile that names a language, so the profile's answer wins over a change
 * made in the game's own menu, and never called for one that names none, so
 * that change is then the player's to keep. A code the installed Minecraft
 * version does not ship is not an error; the game falls back to English.
 */
export async function applyLanguage(gameDir: string, code: string): Promise<void> {
  await editOptions(gameDir, (body) => writeOption(body, LANGUAGE_KEY, code));
}
