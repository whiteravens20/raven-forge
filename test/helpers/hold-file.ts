// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { spawn } from 'node:child_process';

/**
 * Have another program hold a file open on Windows, letting nobody else in.
 *
 * It is what an antivirus does to a file it is reading and what a game does to
 * a world it has open, and it is the thing a mode bit stands in for on every
 * other system: there a test makes a file unreadable with `chmod`, which on
 * Windows changes nothing. So the tests that are about a file somebody else
 * has are staged there the way they happen there.
 *
 * PowerShell opens the file with no sharing at all and says so; it lets go
 * when its input is closed.
 *
 * @returns once the file is held, the way to have it let go
 */
export async function heldByAnotherProgram(file: string): Promise<() => Promise<void>> {
  const quoted = `'${file.replaceAll("'", "''")}'`;
  const holder = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$held = [System.IO.File]::Open(${quoted}, 'Open', 'ReadWrite', 'None'); ` +
        `[Console]::Out.WriteLine('held'); [Console]::In.ReadLine() | Out-Null; $held.Close()`,
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );

  const gone = new Promise<void>((resolve) => holder.once('exit', () => resolve()));
  await new Promise<void>((resolve, reject) => {
    let said = '';
    let complained = '';
    holder.stdout.on('data', (chunk: Buffer) => {
      said += chunk.toString();
      if (said.includes('held')) resolve();
    });
    holder.stderr.on('data', (chunk: Buffer) => (complained += chunk.toString()));
    holder.once('error', reject);
    holder.once('exit', () => reject(new Error(`could not hold ${file}: ${complained.trim()}`)));
  });

  return async () => {
    holder.stdin.end();
    await gone;
  };
}
