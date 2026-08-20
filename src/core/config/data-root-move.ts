import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from '../../main/logger';
import {
  DIR_CACHE,
  DIR_JAVA,
  DIR_LOADERS,
  DIR_PROFILES,
  FILE_AUTH,
  FILE_PROFILES,
  FILE_SETTINGS,
} from '../../shared/constants';
import type { DataRootPlan, DataRootProblem, ProgressEvent } from '../../shared/ipc-types';
import { anyGameRunning } from '../minecraft/game-launcher';
import { dataRoot, dataRootSource, writeDataRootPointer } from './data-root';

/**
 * Moving the data directory.
 *
 * The set below is the launcher's own data and nothing else. It is an explicit
 * list rather than "everything in the folder" because on a default install the
 * root *is* Electron's `userData`, which it shares with Chromium's cookies,
 * caches, GPU shader store and session — none of which is ours, all of which is
 * open while the app runs, and all of which would break the running session if
 * it were dragged onto another volume mid-flight.
 *
 * `logs/` and `crash-reports/` are ours and still not here: `paths.ts` pins them
 * to `userData` on purpose.
 */
const MOVABLE = [
  FILE_SETTINGS,
  FILE_PROFILES,
  FILE_AUTH,
  DIR_PROFILES,
  DIR_LOADERS,
  DIR_JAVA,
  DIR_CACHE,
];

/** What marks a directory as somewhere the launcher has already lived. */
const OCCUPIED_BY = [FILE_PROFILES, FILE_SETTINGS, DIR_PROFILES];

type Progress = (event: ProgressEvent) => void;

interface Item {
  /** Path relative to the root, always with `/` separators from `path.join`. */
  rel: string;
  size: number;
}

async function walk(root: string, rel: string, into: Item[]): Promise<void> {
  const full = path.join(root, rel);
  let stat;
  try {
    stat = await fs.stat(full);
  } catch {
    return; // absent entries are simply not part of the move
  }
  if (stat.isFile()) {
    into.push({ rel, size: stat.size });
    return;
  }
  if (!stat.isDirectory()) return;
  const entries = await fs.readdir(full);
  for (const entry of entries) await walk(root, path.join(rel, entry), into);
}

/** Every file the move would carry, with its size. */
async function movableFiles(root: string): Promise<Item[]> {
  const items: Item[] = [];
  for (const entry of MOVABLE) await walk(root, entry, items);
  return items;
}

export async function movableSize(root: string): Promise<number> {
  return (await movableFiles(root)).reduce((total, item) => total + item.size, 0);
}

/** `true` when `child` is `parent` or sits inside it. */
function isInside(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function looksOccupied(dir: string): Promise<boolean> {
  for (const marker of OCCUPIED_BY) {
    try {
      await fs.stat(path.join(dir, marker));
      return true;
    } catch {
      /* not this one */
    }
  }
  return false;
}

/**
 * A real write, because `access(W_OK)` answers about permissions and not about
 * read-only mounts, full disks or a Windows share that has gone away.
 *
 * Probes the nearest existing ancestor when the directory itself is not there
 * yet: asking the question must not be what creates it.
 */
async function writable(dir: string): Promise<boolean> {
  let probeDir = path.resolve(dir);
  for (;;) {
    try {
      if ((await fs.stat(probeDir)).isDirectory()) break;
      return false; // a file is sitting where the directory would go
    } catch {
      const parent = path.dirname(probeDir);
      if (parent === probeDir) return false;
      probeDir = parent;
    }
  }
  const probe = path.join(probeDir, `.rf-write-test-${process.pid}`);
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
  // The target may not exist yet; the volume is what matters and the nearest
  // existing ancestor is on it.
  let probe = path.resolve(dir);
  for (;;) {
    try {
      const stat = await fs.statfs(probe);
      return stat.bavail * stat.bsize;
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) return undefined;
      probe = parent;
    }
  }
}

/**
 * What choosing `target` would do — decided before anything is touched, so the
 * confirmation can state it and a refusal costs nothing.
 */
export async function planDataRootChange(target: string): Promise<DataRootPlan> {
  const source = dataRoot();
  const resolved = path.resolve(target);

  const refuse = (problem: DataRootProblem): DataRootPlan => ({
    target: resolved,
    action: 'move',
    bytesToMove: 0,
    problem,
  });

  if (dataRootSource() === 'env') return refuse('envLocked');
  if (anyGameRunning()) return refuse('gameRunning');
  if (path.resolve(source) === resolved) return refuse('same');
  if (isInside(resolved, source)) return refuse('nested');
  if (!(await writable(resolved))) return refuse('notWritable');

  const action = (await looksOccupied(resolved)) ? 'adopt' : 'move';
  const bytesToMove = action === 'move' ? await movableSize(source) : 0;
  const freeBytes = await freeSpace(resolved);

  // A little headroom: a copy that lands with nothing to spare leaves a machine
  // that cannot save a world.
  const problem =
    action === 'move' && freeBytes !== undefined && freeBytes < bytesToMove * 1.05
      ? ('noSpace' as const)
      : undefined;

  return { target: resolved, action, bytesToMove, freeBytes, problem };
}

async function copyFile(from: string, to: string): Promise<void> {
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
  // `copyFile` creates with the default mode, and `auth.json` is 0600 for a
  // reason. Carry whatever the source had rather than a guess about which
  // files are sensitive.
  const { mode } = await fs.stat(from);
  await fs.chmod(to, mode).catch(() => undefined);
}

/**
 * Carry the data across and point at it.
 *
 * Copies everything before it deletes anything: a failure halfway leaves the
 * original untouched and a partial copy to throw away, rather than a directory
 * that is half in each place. A same-volume rename skips the copy entirely and
 * is what happens on the common case of moving to another folder on the same
 * disk.
 */
export async function applyDataRoot(target: string, onProgress?: Progress): Promise<void> {
  const plan = await planDataRootChange(target);
  if (plan.problem) throw new Error(`Cannot use ${target}: ${plan.problem}`);

  const source = dataRoot();
  const resolved = plan.target;

  if (plan.action === 'adopt') {
    log.info(`Data directory now ${resolved} (already holds launcher data; nothing moved)`);
    await writeDataRootPointer(resolved);
    return;
  }

  const items = await movableFiles(source);
  const total = items.reduce((sum, item) => sum + item.size, 0);
  let done = 0;
  const report = (currentFile?: string) =>
    onProgress?.({
      operationId: 'data-root',
      progress: total === 0 ? 1 : Math.min(done / total, 1),
      message: { key: 'progress.msg.movingData' },
      currentFile,
      bytesDownloaded: done,
      bytesTotal: total,
    });

  report();
  await fs.mkdir(resolved, { recursive: true });

  /** Top-level entries that were copied and whose originals are still there. */
  const copied: string[] = [];

  for (const entry of MOVABLE) {
    const from = path.join(source, entry);
    const to = path.join(resolved, entry);
    try {
      await fs.stat(from);
    } catch {
      continue; // never existed on this install
    }

    try {
      await fs.rename(from, to);
      done += items
        .filter((item) => item.rel === entry || item.rel.startsWith(`${entry}${path.sep}`))
        .reduce((sum, item) => sum + item.size, 0);
      report(entry);
      continue;
    } catch (err) {
      // EXDEV is the cross-volume case this whole feature exists for; Windows
      // reports the same thing as EPERM.
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EXDEV' && code !== 'EPERM') throw err;
    }

    for (const item of items) {
      if (item.rel !== entry && !item.rel.startsWith(`${entry}${path.sep}`)) continue;
      await copyFile(path.join(source, item.rel), path.join(resolved, item.rel));
      done += item.size;
      report(item.rel);
    }
    copied.push(entry);
  }

  // Everything is in place before the pointer moves, and the originals go last:
  // if the delete fails the data exists twice, which is untidy and not a loss.
  await writeDataRootPointer(resolved);
  for (const entry of copied) {
    await fs
      .rm(path.join(source, entry), { recursive: true, force: true })
      .catch((err: unknown) => {
        log.warn(`Copied ${entry} to ${resolved} but could not remove the original:`, err);
      });
  }
  log.info(`Data directory moved to ${resolved}`);
}
