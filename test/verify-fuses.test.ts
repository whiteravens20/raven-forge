// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * The check that reads Electron's fuses back off a packaged binary.
 *
 * It runs in the packaging job and in the release, which is where a packaged
 * binary is. What can be held on every push is that it still reads a binary at
 * all: it finds each fuse by a name it derives from the config's spelling, and
 * a name that stopped matching would read as "not there" for good — a failure
 * first met on the day of a release.
 *
 * No Electron is needed for that, and since Electron 42 none is there after an
 * install: the binary is fetched the first time it is run. The fuses are a few
 * bytes behind a marker Electron has kept since it had them — a version, a
 * count, and one character for each fuse — so a file made here stands in.
 */

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, '.github/scripts/verify-fuses.mjs');

/** The marker Electron's binary carries in front of its fuses. */
const SENTINEL = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX';
/** The nine fuses as Electron 44 ships them: run-as-Node and the inspector both on. */
const AS_SHIPPED = '101100011';
/** The same with the two the packaging config switches off. */
const AS_PACKED = '001000011';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-fuses-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** A file with fuses in it, one character for each: `1` on, `0` off, `r` removed. */
async function binaryWith(fuses: string): Promise<string> {
  const file = path.join(dir, 'launcher');
  await fs.writeFile(
    file,
    Buffer.concat([
      Buffer.from('\x7fELF and whatever comes before'),
      Buffer.from(SENTINEL),
      Buffer.from([1, fuses.length]),
      Buffer.from(fuses),
      Buffer.from('and whatever comes after'),
    ]),
  );
  return file;
}

const check = (...args: string[]) =>
  spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf-8' });

describe('reading the fuses back off a binary', () => {
  it('passes a binary in which both fuses the config names are off', async () => {
    const result = check(await binaryWith(AS_PACKED));

    expect(result.stdout).toContain('RunAsNode is off');
    expect(result.stdout).toContain('EnableNodeCliInspectArguments is off');
    expect(result.status).toBe(0);
  });

  it('fails an Electron nobody packed, and says which two', async () => {
    const result = check(await binaryWith(AS_SHIPPED));

    expect(result.stderr).toContain('RunAsNode is on');
    expect(result.stderr).toContain('EnableNodeCliInspectArguments is on');
    expect(result.status).toBe(1);
  });

  it('fails on the one that was left on, and only names that one', async () => {
    // The inspector, with run-as-Node off.
    const result = check(await binaryWith('001100011'));

    expect(result.stdout).toContain('RunAsNode is off');
    expect(result.stderr).toContain('EnableNodeCliInspectArguments is on');
    expect(result.stderr).not.toContain('RunAsNode');
    expect(result.status).toBe(1);
  });

  it('does not take a fuse the binary no longer has for one that is off', async () => {
    // A later Electron may remove a fuse, and writes `r` where it was.
    const removed = check(await binaryWith('r01r00011'));
    expect(removed.stderr).toContain('RunAsNode is not there');
    expect(removed.stderr).toContain('EnableNodeCliInspectArguments is not there');
    expect(removed.status).toBe(1);

    // Or the binary is older than the fuse.
    const short = check(await binaryWith('00'));
    expect(short.stderr).toContain('EnableNodeCliInspectArguments is not there');
    expect(short.status).toBe(1);
  });

  it('does not pass a file it could not read as one', () => {
    const result = check(path.join(root, 'package.json'));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('could not read the fuses');
  });

  it('asks for a binary when given none', () => {
    expect(check().status).toBe(2);
  });
});
