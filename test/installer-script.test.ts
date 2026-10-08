// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

/**
 * What `build/installer.nsh` must not do, read off the script itself.
 *
 * Nothing here runs NSIS: the installer is compiled on Windows by the packaging
 * job, and what it does there is checked by running it. This is for the one
 * mistake that compiles, installs, and was shipped in three releases before
 * anybody read the dialog it produced.
 *
 * electron-builder writes a test for each of its installer's command-line flags
 * — `${isUpdated}`, `${isForceRun}`, `${isKeepShortcuts}` and the rest — and
 * every one of them stores its answer, the word "true" or "false", in `$R9`.
 * The uninstaller's own script kept the path of a moved data folder in `$R9`
 * across `${isUpdated}`. So the question it asks before deleting anything read
 * "your data is in: false", on every machine, and for a folder that really had
 * been moved the answer "delete" deleted nothing.
 */

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The lines of one `!macro … !macroend` of the script, comments left out. */
async function macro(name: string): Promise<string[]> {
  const script = await fs.readFile(path.join(root, 'build', 'installer.nsh'), 'utf-8');
  const body = new RegExp(`^!macro ${name}\\b.*\\n([\\s\\S]*?)^!macroend`, 'm').exec(script)?.[1];
  if (body === undefined) throw new Error(`build/installer.nsh has no macro called ${name}`);
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith(';'));
}

describe('the uninstaller’s own script', () => {
  it('rests on a register that electron-builder’s flag tests write to', async () => {
    // The premise of the test below, checked against the library installed: if
    // a later electron-builder moves its answer elsewhere, this says so, and
    // what must be kept clear of is that other place.
    const generator = await fs.readFile(
      path.join(root, 'node_modules/app-builder-lib/out/targets/nsis/nsisScriptGenerator.js'),
      'utf-8',
    );
    expect(generator).toContain('StdUtils.TestParameter} $R9');
  });

  it('takes the data folder out of that register before testing any flag', async () => {
    const lines = await macro('customUnInstall');

    // Read once: handed to a variable of its own, on the line after the macro
    // that leaves it there.
    expect(lines.filter((line) => line.includes('$R9'))).toEqual([
      'StrCpy $ravenForgeDataRoot $R9',
    ]);
    const handedOver = lines.indexOf('StrCpy $ravenForgeDataRoot $R9');
    expect(lines[handedOver - 1]).toBe('!insertmacro readRavenForgeDataRoot');

    // And nothing of electron-builder's is asked before that.
    const firstFlagTest = lines.findIndex((line) => /\$\{is[A-Z]\w*\}/.test(line));
    expect(firstFlagTest).toBeGreaterThan(handedOver);
  });

  it('reads the pointer without asking about a flag half way through', async () => {
    // The macro that fills the register is held to the same thing.
    const lines = await macro('readRavenForgeDataRoot');
    expect(lines.filter((line) => /\$\{is[A-Z]\w*\}/.test(line))).toEqual([]);
  });
});
