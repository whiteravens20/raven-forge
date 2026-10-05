// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { log } from '../../main/logger';
import {
  DIR_CACHE,
  DIR_CRASH_REPORTS,
  DIR_JAVA,
  DIR_LOADERS,
  DIR_LOGS,
  DIR_PROFILES,
  FILE_AUTH,
  FILE_PROFILES,
  FILE_SETTINGS,
  HOME_DIR_NAME,
} from '../../shared/constants';
import type {
  DataRootMoveResult,
  DataRootPlan,
  DataRootProblem,
  ProgressEvent,
} from '../../shared/ipc-types';
import { isLaunchInProgress } from '../minecraft/game-launcher';
import { hasActiveJobs } from '../util/cancellation';
import { dataRoot, dataRootSource, defaultDataRoot, writeDataRootPointer } from './data-root';

/**
 * Moving the data directory.
 *
 * What moves is the launcher's own data and nothing else: a closed list of
 * names, because on a default install the root *is* the launcher's home, which
 * it shares with the embedded browser's files — open while the app runs, and
 * not something to drag onto another volume mid-flight.
 *
 * A move either happens or does not. Entries are renamed where the target is on
 * the same volume and copied where it is not, and until the last of them has
 * arrived nothing points at the new place: a failure puts back what was renamed
 * and removes what was copied, and says so. Only then is the pointer written,
 * and only after that are the copied originals removed. Anything that could not
 * be removed is reported to the person who asked for the move — the first
 * version of this said "nothing is left behind" whatever had happened, and
 * wrote the truth to a log nobody was reading.
 */
const MOVABLE_NAMES = [
  FILE_SETTINGS,
  FILE_PROFILES,
  FILE_AUTH,
  DIR_PROFILES,
  DIR_LOADERS,
  DIR_JAVA,
  DIR_CACHE,
  DIR_LOGS,
  DIR_CRASH_REPORTS,
];

/**
 * Left in both directories for as long as a move is under way, naming the
 * other end. It is how a start after a power cut knows the data is in two
 * places and which way to put it back, and how a later attempt at the same
 * target knows that what it finds there is half a copy and not a root somebody
 * used before.
 */
const MOVE_MARKER = '.raven-forge-moving';
/** The marker's one line: which end this is, and where the other one is. */
const MOVING_TO = 'to ';
const MOVING_FROM = 'from ';

/** A state file set aside because it would not parse; it travels with the rest. */
function isSetAsideStateFile(name: string): boolean {
  return /^(settings|profiles|auth)\.json\.broken-/.test(name);
}

function isMovable(name: string): boolean {
  return MOVABLE_NAMES.includes(name) || isSetAsideStateFile(name);
}

type Progress = (event: ProgressEvent) => void;

/** One thing under a root: a file with its size, a directory, or a link. */
interface Item {
  rel: string;
  kind: 'file' | 'dir' | 'link';
  size: number;
}

/**
 * Everything under `rel`, the entry itself first.
 *
 * `lstat`, so a link is carried as a link. Followed, a world that was linked in
 * from another drive became a second full copy of it at the target, and the
 * player's own arrangement was gone.
 */
async function walk(root: string, rel: string, into: Item[]): Promise<void> {
  let stat;
  try {
    stat = await fs.lstat(path.join(root, rel));
  } catch {
    return; // absent entries are simply not part of the move
  }
  if (stat.isSymbolicLink()) {
    into.push({ rel, kind: 'link', size: 0 });
  } else if (stat.isDirectory()) {
    // Recorded in its own right: an empty directory is still part of a profile
    // — one that has never been launched is nothing else.
    into.push({ rel, kind: 'dir', size: 0 });
    for (const entry of await fs.readdir(path.join(root, rel))) {
      await walk(root, path.join(rel, entry), into);
    }
  } else if (stat.isFile()) {
    into.push({ rel, kind: 'file', size: stat.size });
  }
}

/** The launcher's entries at the top of `root`, by name. */
async function movableEntries(root: string): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch {
    return [];
  }
  return names.filter(isMovable).sort();
}

async function inventory(root: string, entries: string[]): Promise<Item[]> {
  const items: Item[] = [];
  for (const entry of entries) await walk(root, entry, items);
  return items;
}

const totalSize = (items: Item[]): number => items.reduce((sum, item) => sum + item.size, 0);

export async function movableSize(root: string): Promise<number> {
  return totalSize(await inventory(root, await movableEntries(root)));
}

/** `true` when `child` is `parent` or sits inside it. */
function isInside(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

/** The nearest ancestor of `dir` that exists, `dir` itself included. */
async function nearestExisting(dir: string): Promise<string | null> {
  let probe = path.resolve(dir);
  for (;;) {
    if (await exists(probe)) return probe;
    const parent = path.dirname(probe);
    if (parent === probe) return null;
    probe = parent;
  }
}

/**
 * A real write, because `access(W_OK)` answers about permissions and not about
 * read-only mounts, full disks or a Windows share that has gone away.
 *
 * Probes the nearest existing ancestor when the directory itself is not there
 * yet: asking the question must not be what creates it.
 */
async function writable(dir: string): Promise<boolean> {
  const base = await nearestExisting(dir);
  if (!base) return false;
  try {
    if (!(await fs.stat(base)).isDirectory()) return false; // a file is in the way
  } catch {
    return false;
  }
  const probe = path.join(base, `.rf-write-test-${process.pid}`);
  try {
    await fs.writeFile(probe, '');
    return true;
  } catch {
    return false;
  } finally {
    await fs.rm(probe, { force: true }).catch(() => undefined);
  }
}

async function freeSpace(dir: string): Promise<number | undefined> {
  const base = await nearestExisting(dir);
  if (!base) return undefined;
  try {
    const stat = await fs.statfs(base);
    return stat.bavail * stat.bsize;
  } catch {
    return undefined;
  }
}

/** Whether a move from `source` to `target` stays on one volume. */
async function sameVolume(source: string, target: string): Promise<boolean> {
  const base = await nearestExisting(target);
  if (!base) return false;
  try {
    return (await fs.stat(source)).dev === (await fs.stat(base)).dev;
  } catch {
    return false;
  }
}

/**
 * Whether `dir` holds somebody's launcher data — profiles, which is the part
 * that cannot be downloaded again.
 *
 * Deliberately not "does it hold any of the launcher's files". A folder the
 * launcher merely stood in for an unplugged drive holds a default
 * `settings.json` and four empty directories, and so does the debris of an
 * attempt that was interrupted; reading either as "a folder you used before"
 * meant switching to it and leaving the real data where it was, with the
 * launcher restarting empty.
 */
async function holdsProfiles(dir: string): Promise<boolean> {
  try {
    const listed: unknown = JSON.parse(await fs.readFile(path.join(dir, FILE_PROFILES), 'utf-8'));
    if (Array.isArray(listed) && listed.length > 0) return true;
  } catch {
    /* no list, or not one that says anything */
  }
  try {
    return (await fs.readdir(path.join(dir, DIR_PROFILES))).length > 0;
  } catch {
    return false;
  }
}

/** What was found at a place the player pointed at. */
type Finding =
  /** Nothing of the launcher's and nothing else: move in. */
  | 'empty'
  /** Launcher data with profiles in it: use it as it is. */
  | 'launcher-data'
  /** The launcher's names with nothing behind them, or half a copy: replace. */
  | 'debris'
  /** Other people's files. The data goes in a folder of its own beneath it. */
  | 'foreign';

async function inspect(dir: string): Promise<Finding> {
  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter((name) => !isOsNoise(name));
  } catch {
    return 'empty'; // not there yet
  }
  // The home is the launcher's own folder, and whatever else is in it — the
  // pointer, the browser's files — is the launcher's too. Only the data's own
  // names say anything about whether data is there; without this, going back
  // to the default found "other people's files" in the launcher's own home and
  // offered to make a folder inside it.
  if (path.resolve(dir) === path.resolve(defaultDataRoot())) names = names.filter(isDataEntry);
  if (names.length === 0) return 'empty';
  // Before anything else: an unfinished move leaves profiles behind too, and
  // they are half a copy, not a root.
  if (names.includes(MOVE_MARKER)) return 'debris';
  if (await holdsProfiles(dir)) return 'launcher-data';
  return names.every(isDataEntry) ? 'debris' : 'foreign';
}

/** A name the data folder uses: something that moves, or the mark of a move. */
function isDataEntry(name: string): boolean {
  return isMovable(name) || name === MOVE_MARKER;
}

/** Files an operating system drops into any folder a person has opened. */
function isOsNoise(name: string): boolean {
  return ['.DS_Store', 'Thumbs.db', 'desktop.ini', '.directory'].includes(name);
}

/**
 * What about a path a game started from it may trip over.
 *
 * Minecraft itself copes with both. A few hundred mods and the tools they
 * shell out to do not all: a space or a letter outside ASCII in the path is a
 * known way for one of them to fail on one machine and nowhere else.
 */
export function pathConcerns(dir: string): { hasSpaces: boolean; hasNonAscii: boolean } {
  return {
    hasSpaces: dir.includes(' '),
    hasNonAscii: /[^\x20-\x7e]/.test(dir),
  };
}

/**
 * What choosing `chosen` would do — decided before anything is touched, so the
 * confirmation can state it and a refusal costs nothing.
 *
 * The folder that ends up holding the data is not always the folder that was
 * picked. Pointed at one that already has other things in it — `D:\Games`,
 * a Downloads folder — the launcher makes a folder of its own inside. Scattering
 * `profiles/`, `java/` and `settings.json` among somebody's files was bad
 * enough; the uninstaller then offered to "delete the launcher's data" and
 * meant the whole of whatever folder that was.
 */
export async function planDataRootChange(chosen: string): Promise<DataRootPlan> {
  const source = dataRoot();
  const picked = path.resolve(chosen);

  const refuse = (problem: DataRootProblem, target = picked): DataRootPlan => ({
    target,
    action: 'move',
    bytesToMove: 0,
    sameVolume: false,
    hasSpaces: false,
    hasNonAscii: false,
    problem,
  });

  if (dataRootSource() === 'env') return refuse('envLocked');
  if (isLaunchInProgress() || hasActiveJobs()) return refuse('gameRunning');
  if (moving) return refuse('gameRunning');

  let target = picked;
  let found = await inspect(target);
  if (found === 'foreign') {
    target = path.join(picked, HOME_DIR_NAME);
    found = await inspect(target);
    // A folder of that name that is not ours either. Rare, and not one to guess
    // about: the player picks somewhere else.
    if (found === 'foreign') return refuse('notEmpty', target);
  }

  if (path.resolve(source) === target) return refuse('same', target);
  if (isInside(target, source) || isInside(source, target)) return refuse('nested', target);
  if (!(await writable(target))) return refuse('notWritable', target);

  const action = found === 'launcher-data' ? 'adopt' : 'move';
  const onSameVolume = await sameVolume(source, target);
  const bytesToMove = action === 'move' ? await movableSize(source) : 0;
  const freeBytes = await freeSpace(target);

  // Only when the bytes actually have to be written again. A rename within one
  // volume needs no room at all, and refusing it for lack of space refused the
  // commonest move there is — to another folder on a nearly full disk. A little
  // headroom otherwise: a copy that lands with nothing to spare leaves a machine
  // that cannot save a world.
  const problem =
    action === 'move' && !onSameVolume && freeBytes !== undefined && freeBytes < bytesToMove * 1.05
      ? ('noSpace' as const)
      : undefined;

  return {
    target,
    action,
    bytesToMove,
    freeBytes,
    sameVolume: onSameVolume,
    replacesDebris: found === 'debris',
    // Leaving the home for the first time leaves the home behind, with the
    // pointer and the browser's files in it. Leaving any other folder leaves
    // nothing, and the folder itself is removed.
    leavesHome: path.resolve(source) === path.resolve(defaultDataRoot()),
    ...pathConcerns(target),
    problem,
  };
}

async function copyItem(source: string, target: string, item: Item): Promise<void> {
  const from = path.join(source, item.rel);
  const to = path.join(target, item.rel);

  if (item.kind === 'dir') {
    await fs.mkdir(to, { recursive: true });
    return;
  }
  await fs.mkdir(path.dirname(to), { recursive: true });
  if (item.kind === 'link') {
    await fs.symlink(await fs.readlink(from), to);
    return;
  }
  await fs.copyFile(from, to);
  // `auth.json` is 0600 for a reason; carry whatever the source had rather than
  // a guess about which files are sensitive. And the times, so "last played"
  // sorted by date in a file manager still means something afterwards.
  const stat = await fs.stat(from);
  await fs.chmod(to, stat.mode).catch(() => undefined);
  await fs.utimes(to, stat.atime, stat.mtime).catch(() => undefined);
}

/** How often the move says where it has got to. */
const PROGRESS_INTERVAL_MS = 100;

/** A move in flight; a second one must not start beside it. */
let moving = false;

/** Whether the data directory is being moved right now. */
export function isMovingDataRoot(): boolean {
  return moving;
}

/**
 * Carry the data across and point at it.
 *
 * See the note at the top of this file for the order things happen in and what
 * a failure at each point leaves behind.
 */
export async function applyDataRoot(
  chosen: string,
  onProgress?: Progress,
): Promise<DataRootMoveResult> {
  const plan = await planDataRootChange(chosen);
  if (plan.problem) throw new Error(`Cannot use ${plan.target}: ${plan.problem}`);
  if (moving) throw new Error('The data directory is already being moved');

  moving = true;
  try {
    return await move(plan, onProgress);
  } finally {
    moving = false;
  }
}

async function move(plan: DataRootPlan, onProgress?: Progress): Promise<DataRootMoveResult> {
  const source = dataRoot();
  const target = plan.target;

  if (plan.action === 'adopt') {
    log.info(`Data directory now ${target} (already holds launcher data; nothing moved)`);
    await writeDataRootPointer(target);
    return { target, leftovers: [] };
  }

  const entries = await movableEntries(source);
  const items = await inventory(source, entries);
  const total = totalSize(items);
  let done = 0;
  let lastReport = 0;
  const report = (currentFile?: string, force = false) => {
    const now = Date.now();
    if (!force && now - lastReport < PROGRESS_INTERVAL_MS) return;
    lastReport = now;
    onProgress?.({
      operationId: 'data-root',
      progress: total === 0 ? 1 : Math.min(done / total, 1),
      message: { key: 'progress.msg.movingData' },
      currentFile,
      bytesDownloaded: done,
      bytesTotal: total,
    });
  };
  const sizeOf = (entry: string) =>
    totalSize(items.filter((i) => i.rel === entry || i.rel.startsWith(`${entry}${path.sep}`)));

  report(undefined, true);
  await fs.mkdir(target, { recursive: true });

  // From here until the pointer is written the data may be in two places.
  await fs.writeFile(path.join(target, MOVE_MARKER), `${MOVING_FROM}${source}\n`, 'utf-8');
  await fs.writeFile(path.join(source, MOVE_MARKER), `${MOVING_TO}${target}\n`, 'utf-8');

  /** Entries renamed across, in order — put back in reverse on failure. */
  const renamed: string[] = [];
  /** Entries copied across, whose originals are still where they were. */
  const copied: string[] = [];

  const undo = async () => {
    for (const entry of copied) {
      await fs
        .rm(path.join(target, entry), { recursive: true, force: true })
        .catch(() => undefined);
    }
    const stranded: string[] = [];
    for (const entry of renamed.reverse()) {
      await fs.rename(path.join(target, entry), path.join(source, entry)).catch(() => {
        stranded.push(entry);
      });
    }
    // With something stranded both markers stay: the next start reads the one
    // here and tries once more to bring those entries back.
    if (stranded.length === 0) {
      await fs.rm(path.join(source, MOVE_MARKER), { force: true }).catch(() => undefined);
      await fs.rm(path.join(target, MOVE_MARKER), { force: true }).catch(() => undefined);
      await fs.rmdir(target).catch(() => undefined); // only if the move made it
    }
    return stranded;
  };

  try {
    // What an earlier, unfinished attempt left at the target, or the empty
    // shell of a launcher that only ever stood in there.
    if (plan.replacesDebris) {
      for (const entry of await movableEntries(target)) {
        await fs.rm(path.join(target, entry), { recursive: true, force: true });
      }
    }

    for (const entry of entries) {
      const from = path.join(source, entry);
      const to = path.join(target, entry);

      if (plan.sameVolume) {
        try {
          await fs.rename(from, to);
          renamed.push(entry);
          done += sizeOf(entry);
          report(entry);
          continue;
        } catch (err) {
          // Not fatal by itself: Windows refuses to rename a directory with a
          // file open somewhere beneath it, and a copy can still read most of
          // those. Whatever cannot be copied either stops the move below.
          log.warn(`Could not rename ${entry} into ${target}, copying instead:`, err);
        }
      }

      copied.push(entry);
      for (const item of items) {
        if (item.rel !== entry && !item.rel.startsWith(`${entry}${path.sep}`)) continue;
        await copyItem(source, target, item);
        done += item.size;
        report(item.rel);
      }
    }

    // What arrived is compared with what was sent before anything depends on
    // it: a copy that came up short must not become the data.
    const arrived = await inventory(target, copied);
    const sent = items.filter((item) =>
      copied.some((entry) => item.rel === entry || item.rel.startsWith(`${entry}${path.sep}`)),
    );
    if (arrived.length !== sent.length || totalSize(arrived) !== totalSize(sent)) {
      throw new Error(
        `The copy at ${target} does not match the original ` +
          `(${arrived.length} of ${sent.length} entries, ${totalSize(arrived)} of ${totalSize(sent)} bytes)`,
      );
    }
  } catch (err) {
    const stranded = await undo();
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      stranded.length === 0
        ? `${reason}. Nothing was moved; the data is where it was.`
        : `${reason}. These could not be put back and are now in ${target}: ${stranded.join(', ')}`,
      { cause: err },
    );
  }

  // Everything is in place. The pointer moves, and from this line the target
  // is the data.
  await writeDataRootPointer(target);
  await fs.rm(path.join(target, MOVE_MARKER), { force: true }).catch(() => undefined);
  await fs.rm(path.join(source, MOVE_MARKER), { force: true }).catch(() => undefined);

  // The originals go last: if one will not go, the data exists twice, which is
  // untidy and not a loss — and the person who moved it is told where.
  const leftovers: string[] = [];
  for (const entry of copied) {
    try {
      await fs.rm(path.join(source, entry), { recursive: true, force: true });
    } catch (err) {
      log.warn(`Copied ${entry} to ${target} but could not remove the original:`, err);
      leftovers.push(path.join(source, entry));
    }
  }

  // A folder the data has left for good is removed with it — unless it is the
  // home, which still holds the pointer and the browser's files, or it still
  // has something in it, in which case `rmdir` refuses and that is the answer.
  if (!plan.leavesHome) await fs.rmdir(source).catch(() => undefined);

  report(undefined, true);
  log.info(
    `Data directory moved to ${target}` +
      (leftovers.length > 0 ? ` (${leftovers.length} original(s) could not be removed)` : ''),
  );
  return { target, leftovers };
}

/**
 * Put back a move that was cut off before it finished.
 *
 * Run at startup, before anything reads the data. A move that renames its
 * entries one at a time can be stopped between two of them — a power cut, the
 * process killed — and then the launcher's root holds half its data and the
 * other half is in a folder nothing points at: every profile listed, no worlds
 * in any of them. The marker the move left names that folder, and whatever of
 * the launcher's is there and missing here is brought back.
 *
 * Synchronous because of when it runs. Only ever renames: a move that had to
 * copy never removed an original before it finished, so there is nothing of
 * that kind to bring back.
 */
export function recoverInterruptedMove(root: string): void {
  const marker = path.join(root, MOVE_MARKER);
  let line: string;
  try {
    line = fsSync.readFileSync(marker, 'utf-8').trim();
  } catch {
    return; // no move was under way
  }

  if (line.startsWith(MOVING_TO)) {
    // This is the folder the data was leaving, and it is still the root: the
    // move never got as far as pointing anywhere else.
    const other = line.slice(MOVING_TO.length);
    let names: string[] = [];
    try {
      if (path.isAbsolute(other)) names = fsSync.readdirSync(other).filter(isMovable);
    } catch {
      /* the other end is not reachable; what is here is what there is */
    }
    for (const name of names) {
      const here = path.join(root, name);
      if (fsSync.existsSync(here)) continue;
      try {
        fsSync.renameSync(path.join(other, name), here);
      } catch {
        /* on another volume: it was a copy, and the original is here already */
      }
    }
    // The other end keeps its marker: what is left there is half a copy, and
    // the marker is what says so to the next attempt.
  } else if (line.startsWith(MOVING_FROM)) {
    // This is where the data was going, and it is the root: the move finished
    // all but its tidying up. The folder it left has nothing more to say.
    const other = line.slice(MOVING_FROM.length);
    if (path.isAbsolute(other)) fsSync.rmSync(path.join(other, MOVE_MARKER), { force: true });
  }
  fsSync.rmSync(marker, { force: true });
}
