// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

/**
 * The check that reads Electron's fuses back off a packaged binary.
 *
 * It runs in the packaging job and in the release, which is where a packaged
 * binary is. What can be held on every push is that it still reads a binary at
 * all: it finds each fuse by a name it derives from the config's spelling, and
 * a name that stopped matching would read as "not there" for good — a failure
 * first met on the day of a release.
 *
 * The Electron in node_modules is the binary as Electron ships it, with the two
 * fuses the config switches off still on. So here the check has to fail, and
 * say which two.
 */

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, '.github/scripts/verify-fuses.mjs');

const check = (binary: string) =>
  spawnSync(process.execPath, [script, binary], { cwd: root, encoding: 'utf-8' });

/** Where the `electron` package says its binary is, without loading the package. */
function electronBinary(): string {
  const dist = path.join(root, 'node_modules/electron');
  return path.join(dist, 'dist', fs.readFileSync(path.join(dist, 'path.txt'), 'utf-8'));
}

describe('reading the fuses back off a binary', () => {
  it('finds both fuses the config names, and finds them on in an Electron nobody packed', () => {
    const result = check(electronBinary());

    expect(result.stderr).toContain('RunAsNode is on');
    expect(result.stderr).toContain('EnableNodeCliInspectArguments is on');
    expect(result.stderr).not.toContain('not there');
    expect(result.status).toBe(1);
  });

  it('does not pass a file it could not read as one', () => {
    const result = check(path.join(root, 'package.json'));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('could not read the fuses');
  });

  it('asks for a binary when given none', () => {
    expect(spawnSync(process.execPath, [script], { cwd: root }).status).toBe(2);
  });
});
