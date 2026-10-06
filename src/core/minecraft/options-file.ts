// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic } from '../util/atomic-file';

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

/**
 * The line ending the file already has. Minecraft on Windows writes CRLF, and a
 * file read as if it were LF kept a `\r` on every value: a setting that had not
 * changed never compared equal, so the file was rewritten at every launch, and
 * the rewritten line lost its `\r` while the others kept theirs.
 */
function lineEnding(body: string): string {
  return body.includes('\r\n') ? '\r\n' : '\n';
}

/** Extract the raw value of `key` from an options.txt body, or null. */
function readOption(body: string, key: string): string | null {
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith(`${key}:`)) return line.slice(key.length + 1).trimEnd();
  }
  return null;
}

/** Replace `key`'s line, or append it when the file does not have one yet. */
function writeOption(body: string, key: string, value: string): string {
  const eol = lineEnding(body);
  const lines = body.split(/\r?\n/);
  const index = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (index >= 0) {
    lines[index] = `${key}:${value}`;
    return lines.join(eol);
  }
  const trimmed = body.endsWith(eol) ? body.slice(0, -eol.length) : body;
  return trimmed === '' ? `${key}:${value}${eol}` : `${trimmed}${eol}${key}:${value}${eol}`;
}

/**
 * Read the profile's `options.txt`, change it, and write it back.
 *
 * The file belongs to the player, not to the launcher: every other setting is
 * copied through untouched, and the write goes to a temporary file first so a
 * crash mid-write cannot leave them with a truncated settings file. A profile
 * that has never been launched has no `options.txt` yet — one is created with
 * just the lines being set, and Minecraft fills in the rest at its first save.
 *
 * Only a file that is not there counts as an empty one. Any failure to read
 * used to: a file that was locked or unreadable for a moment was taken for a
 * profile that had never been launched, and a one-line file was then renamed
 * over every setting the player had.
 */
async function editOptions(gameDir: string, edit: (body: string) => string): Promise<void> {
  const file = path.join(gameDir, 'options.txt');

  let body = '';
  try {
    body = await fs.readFile(file, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const next = edit(body);
  if (next === body) return;

  await writeFileAtomic(file, next);
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

/** What a profile says about the game's own settings. Unset means "leave it". */
export interface ProfileOptions {
  fullscreen?: boolean;
  /** A language code as the game spells it, `pl_pl`. */
  language?: string;
}

/**
 * State the profile's choices in the file the game reads them from.
 *
 * Called on every launch, so the profile's answer wins over whatever the last
 * session left behind — which is the whole point: F11 during play writes
 * `fullscreen:true` here on exit, and a profile that says "windowed" has to be
 * able to mean it a second time. The language has no other way in at all; there
 * is no launch argument for it.
 *
 * A choice the profile does not make is left alone, so the game's own memory of
 * what the player last did survives. A language code the installed Minecraft
 * version does not ship is not an error; the game falls back to English.
 *
 * Both in one pass over the file: they used to be two, each reading and writing
 * the whole of it.
 */
export async function applyProfileOptions(gameDir: string, options: ProfileOptions): Promise<void> {
  const { fullscreen, language } = options;
  if (fullscreen === undefined && !language) return;

  await editOptions(gameDir, (body) => {
    let next = body;
    if (fullscreen !== undefined) next = writeOption(next, FULLSCREEN_KEY, String(fullscreen));
    if (language) next = writeOption(next, LANGUAGE_KEY, language);
    return next;
  });
}
