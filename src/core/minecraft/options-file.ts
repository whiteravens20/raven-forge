import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * The one line of `options.txt` this launcher writes.
 *
 * Installing a resource pack into `resourcepacks/` does not enable it — the
 * game only loads what this line names, which is why a synced pack used to sit
 * in the folder doing nothing until the player enabled it by hand.
 */
const RESOURCE_PACKS_KEY = 'resourcePacks';

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
 * packs get in and out of it, so its list is the source of truth for what is
 * selected from there. Anything else in the line — `vanilla`, `mod_resources`,
 * a namespaced pack a mod contributes — belongs to the game or a mod and is
 * copied through untouched.
 *
 * The cost of that rule is a zip copied into the folder by hand: it stays
 * installed, but the next launcher-side change unselects it. The alternative is
 * worse — a pack removed in the launcher would stay listed forever, still
 * winning over the packs below it until the player noticed.
 */
function isFolderPack(entry: string): boolean {
  return entry.startsWith('file/') || entry.toLowerCase().endsWith('.zip');
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
 * @param existing the current value, e.g. `["vanilla","mod_resources"]`, or null
 * @param orderedFileNames pack file names, highest priority first
 */
export function buildResourcePacksValue(
  existing: string | null,
  orderedFileNames: string[],
): string {
  let foreign: string[] = [];
  if (existing) {
    try {
      const parsed: unknown = JSON.parse(existing);
      if (Array.isArray(parsed)) {
        foreign = parsed
          .filter((e): e is string => typeof e === 'string')
          .filter((e) => !isFolderPack(e));
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
 * Point the profile's `options.txt` at these packs, in this order.
 *
 * The file belongs to the player, not to the launcher: every other setting is
 * copied through untouched, and the write goes to a temporary file first so a
 * crash mid-write cannot leave them with a truncated settings file. A profile
 * that has never been launched has no `options.txt` yet — one is created with
 * just this line, and Minecraft fills in the rest at its first save.
 *
 * @param orderedFileNames pack file names, highest priority first
 */
export async function applyResourcePackOrder(
  gameDir: string,
  orderedFileNames: string[],
): Promise<void> {
  const file = path.join(gameDir, 'options.txt');

  let body = '';
  try {
    body = await fs.readFile(file, 'utf-8');
  } catch {
    /* never launched — a one-line file is a valid options.txt */
  }

  const next = writeOption(
    body,
    RESOURCE_PACKS_KEY,
    buildResourcePacksValue(readOption(body, RESOURCE_PACKS_KEY), orderedFileNames),
  );
  if (next === body) return;

  await fs.mkdir(gameDir, { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, next, 'utf-8');
  await fs.rename(tmp, file);
}
