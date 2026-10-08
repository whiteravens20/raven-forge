// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * A stand-in for Java on Windows.
 *
 * Everywhere else a shell script is one: `java -version` is a banner on stderr,
 * and a script that prints it is a runtime as far as the launcher can tell.
 * Windows starts no script as a program, so the stand-in there has to be one —
 * `stand-in-java.cs`, built with the C# compiler that is part of Windows
 * itself. That is what lets the two things only a Windows can show be shown at
 * all: its own `tar` unpacking the runtime, and its own `taskkill` asking a
 * game to close.
 *
 * Built once for each test file that asks, into a folder of its own, which the
 * file that asked removes when it is done.
 */
let built: Promise<string> | undefined;

/**
 * How long the building may take, for the hook that waits for it.
 *
 * It is a compiler started cold on a machine that is running a hundred other
 * test files at the time: a second or two as a rule, and once more than the
 * ten seconds a hook is given, which failed a run that had nothing wrong with
 * it. So it is built in a hook with room of its own, and no test pays for it
 * out of the few seconds it has.
 */
export const STAND_IN_BUILD_MS = 120_000;

export function standInJava(): Promise<string> {
  built ??= (async () => {
    const windows = process.env.SystemRoot ?? 'C:\\Windows';
    const compiler = path.join(windows, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-stand-in-'));
    const program = path.join(dir, 'java.exe');
    await run(compiler, [
      '/nologo',
      '/target:winexe',
      `/out:${program}`,
      '/r:System.Windows.Forms.dll',
      path.join(__dirname, 'stand-in-java.cs'),
    ]);
    return program;
  })();
  return built;
}
