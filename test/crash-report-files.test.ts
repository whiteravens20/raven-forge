// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { CrashReportInput } from '../src/core/diagnostics/crash-report';

/**
 * The crash reports folder: what gets written into it, and what gets cleared
 * out to make room.
 *
 * The folder keeps the newest twenty. Which twenty that is has to be decided by
 * when each was written, and the name puts the profile before the date — so
 * "newest" was being answered alphabetically, by profile.
 */

const { userData } = vi.hoisted(() => ({ userData: { path: '' } }));

vi.mock('electron', () => ({
  app: { getPath: () => userData.path, getVersion: () => '0.0.0-test', isPackaged: false },
}));

vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

const { writeCrashReport } = await import('../src/core/diagnostics/crash-report');
const { reloadDataRoot } = await import('../src/core/config/data-root');

let root: string;
const reportsDir = () => path.join(root, 'userData', 'crash-reports');

/** A crash of the profile called `name`, with nothing else worth saying about it. */
function crashOf(name: string): CrashReportInput {
  return {
    profile: {
      id: 'p1',
      name,
      minecraftVersion: '1.21.4',
      modLoader: 'vanilla',
      allocatedRamMb: 4096,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
    exitCode: 1,
    playTimeMinutes: 3,
    logTail: [],
    gameDir: path.join(root, 'game'),
    java: { path: '/data/java/jre-21/bin/java', version: 21 },
    accountType: 'offline',
    offlineLaunch: true,
    secrets: [],
  };
}

/** Reports already in the folder, one a day from the 1st of September 2001. */
async function seed(slug: string, count: number): Promise<string[]> {
  await fs.mkdir(reportsDir(), { recursive: true });
  const names: string[] = [];
  for (let day = 1; day <= count; day++) {
    const name = `crash-${slug}-200109${String(day).padStart(2, '0')}-180000.txt`;
    await fs.writeFile(path.join(reportsDir(), name), 'an old report');
    names.push(name);
  }
  return names;
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-crash-files-'));
  userData.path = path.join(root, 'userData');
  // The reports are kept with the data, and where the data is gets worked out
  // once and remembered — so each case has it worked out again.
  reloadDataRoot();
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('writeCrashReport', () => {
  it('still has the report it just wrote, when the folder was already full', async () => {
    // Twenty reports from "Raven Forge", then "Classic" crashes. By name,
    // `crash-classic-…` sorts ahead of all of them, so it was the "oldest".
    const old = await seed('raven-forge', 20);

    const file = await writeCrashReport(crashOf('Classic'));

    expect(path.basename(file!)).toMatch(/^crash-classic-\d{8}-\d{6}\.txt$/);
    await expect(fs.readFile(file!, 'utf-8')).resolves.toContain('# Raven Forge crash report');
    // Room was made by dropping the one that really is the oldest.
    const left = await fs.readdir(reportsDir());
    expect(left).toHaveLength(20);
    expect(left).not.toContain(old[0]);
    expect(left).toContain(old[1]);
  });

  it('clears out by date across profiles, not by whose name sorts first', async () => {
    // "zeta" has the old ones and "alpha" the recent ones; alphabetically it is
    // the other way round.
    await fs.mkdir(reportsDir(), { recursive: true });
    const recent = Array.from({ length: 19 }, (_, i) => `crash-alpha-20020101-1200${10 + i}.txt`);
    for (const name of recent) await fs.writeFile(path.join(reportsDir(), name), 'recent');
    const old = await seed('zeta', 3);

    const file = await writeCrashReport(crashOf('Middle'));

    const left = await fs.readdir(reportsDir());
    expect(left.sort()).toEqual([...recent, path.basename(file!)].sort());
    for (const name of old) expect(left).not.toContain(name);
  });

  it('keeps everything while there are no more than twenty', async () => {
    const old = await seed('raven-forge', 19);

    const file = await writeCrashReport(crashOf('Raven Forge'));

    expect((await fs.readdir(reportsDir())).sort()).toEqual([...old, path.basename(file!)].sort());
  });

  it('neither counts nor deletes a file it did not name', async () => {
    // Somebody keeping the game's own crash file here, and their notes on it.
    const old = await seed('raven-forge', 20);
    const kept = ['crash-2026-08-07_15.46.31-client.txt', 'crash-notes.txt', 'readme.md'];
    for (const name of kept) await fs.writeFile(path.join(reportsDir(), name), 'not ours');

    await writeCrashReport(crashOf('Classic'));

    const left = await fs.readdir(reportsDir());
    for (const name of kept) expect(left).toContain(name);
    expect(left).not.toContain(old[0]);
    expect(left).toHaveLength(20 + kept.length);
  });
});
