// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import { describe, it, expect } from 'vitest';
import { systemTool } from '../src/core/util/system-tool';

/**
 * The two programs of Windows' own that the launcher starts: `tar`, to unpack
 * the Java runtime, and `taskkill`, to ask a game to close.
 *
 * Started by name, a program is looked for on Windows in the folder the
 * launcher was started from before anywhere else, so they are started by the
 * path Windows keeps them at. Whether they are really there is something only
 * a Windows can say, and the second half of this file is where it says so.
 */

const run = promisify(execFile);
const onWindows = process.platform === 'win32';

describe('a program of the system’s own', () => {
  it('is named by its full path on Windows, under wherever Windows is installed', () => {
    expect(systemTool('tar', 'win32', { SystemRoot: 'C:\\Windows' })).toBe(
      'C:\\Windows\\System32\\tar.exe',
    );
    expect(systemTool('taskkill', 'win32', { SystemRoot: 'D:\\WINNT' })).toBe(
      'D:\\WINNT\\System32\\taskkill.exe',
    );
  });

  it('is still found when the environment says less than it should', () => {
    expect(systemTool('tar', 'win32', { windir: 'E:\\Windows' })).toBe(
      'E:\\Windows\\System32\\tar.exe',
    );
    expect(systemTool('tar', 'win32', {})).toBe('C:\\Windows\\System32\\tar.exe');
  });

  it('is left to the search path everywhere else', () => {
    expect(systemTool('tar', 'linux', { SystemRoot: 'C:\\Windows' })).toBe('tar');
    expect(systemTool('tar', 'darwin', {})).toBe('tar');
  });
});

describe.skipIf(!onWindows)('on this Windows', () => {
  it('tar is where it is looked for, and is the one that reads a zip', async () => {
    const tar = systemTool('tar');
    await expect(fs.access(tar)).resolves.toBeUndefined();

    // bsdtar, which unpacks the zip a Windows Java runtime comes as. GNU tar,
    // which is what a name alone finds on a machine with Git first on its path,
    // does not.
    const { stdout } = await run(tar, ['--version']);
    expect(stdout).toMatch(/bsdtar/);
  });

  it('taskkill is where it is looked for, and starts', async () => {
    const taskkill = systemTool('taskkill');
    await expect(fs.access(taskkill)).resolves.toBeUndefined();

    const { stdout } = await run(taskkill, ['/?']);
    expect(stdout).toMatch(/TASKKILL/i);
  });
});
