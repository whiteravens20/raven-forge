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

/**
 * The folder the uninstaller's question names, laid out so that it fits.
 *
 * Windows gives a question a narrow box and cuts a line that is too long for
 * it wherever the room runs out — for a path, in the middle of a name. The
 * script cuts the path itself first, after a backslash. That the lines it
 * makes do fit is measured where the question is shown, on Windows, by the
 * packaging job; what is held here is that the question quotes the path as it
 * was laid out, and that laying it out disturbs nothing around it.
 */
describe('the folder in the uninstaller’s question', () => {
  it('is laid out once it is known, and before the question is put together', async () => {
    const lines = await macro('customUnInstall');
    const laidOut = lines.indexOf('!insertmacro layOutRavenForgePath');
    const chosen = lines.flatMap((line, at) => (line.startsWith('StrCpy $R3 ') ? [at] : []));
    const worded = lines.flatMap((line, at) => (line.startsWith('StrCpy $R8 "') ? [at] : []));

    // Three places it can be, one wording for each of two languages.
    expect(chosen).toHaveLength(3);
    expect(worded).toHaveLength(2);
    expect(laidOut).toBeGreaterThan(Math.max(...chosen));
    expect(laidOut).toBeLessThan(Math.min(...worded));
  });

  it('is quoted as it was laid out, in both languages', async () => {
    const lines = await macro('customUnInstall');
    for (const wording of lines.filter((line) => line.startsWith('StrCpy $R8 "'))) {
      expect(wording).toContain('$R4');
      expect(wording).not.toContain('$R3');
    }
  });

  it('is laid out in registers nothing around it is using', async () => {
    // $R0 to $R2 belong to the stock uninstall section either side of the
    // macro, and $R9 to electron-builder's flag tests.
    const lines = await macro('layOutRavenForgePath');
    const used = new Set(lines.flatMap((line) => line.match(/\$R\d/g) ?? []));

    expect([...used].sort()).toEqual(['$R3', '$R4', '$R5', '$R6', '$R7', '$R8']);
    // And the path it was handed is still there afterwards.
    expect(lines.filter((line) => /^(StrCpy|StrLen|IntOp) \$R3\b/.test(line))).toEqual([]);
  });

  it('is cut after a backslash, and never after the first of them', async () => {
    const lines = await macro('layOutRavenForgePath');
    // What is looked for, going back from the end of a line …
    expect(lines).toContain('StrCmp $R7 "\\" 0 rfSeekBackslash');
    // … and where the looking stops: a cut after `C:\` would leave three
    // characters on a line by themselves.
    expect(lines).toContain('IntCmp $R6 3 0 rfLastLine 0');
  });
});

/**
 * The folder page of the installer, where an install made by an older build is
 * offered under its old name.
 *
 * The installer has always moved such an install to the new name, one step
 * after the page — so the page showed one folder and the files went to
 * another. The page is put right by `.onVerifyInstDir`, which NSIS calls with
 * whatever the page's field holds. That it does what it should was seen by
 * running it; what is held here is what it rests on, because the packaging job
 * that would notice a broken script runs nightly and not on a push.
 */
describe('the installer’s folder page', () => {
  const templates = path.join(root, 'node_modules/app-builder-lib/templates/nsis');

  /** The lines of the function a macro defines, from its name to its end. */
  const functionIn = (lines: string[], name: string): string[] => {
    const start = lines.indexOf(`Function ${name}`);
    const end = lines.indexOf('FunctionEnd', start);
    if (start < 0 || end < 0) throw new Error(`no function called ${name}`);
    return lines.slice(start + 1, end);
  };

  it('answers a question the template does not answer itself', async () => {
    // Two functions of one name do not compile.
    const files = await fs.readdir(templates, { recursive: true });
    const scripts = files.filter((file) => /\.ns[hi]$/.test(file));
    expect(scripts.length).toBeGreaterThan(10);
    for (const file of scripts) {
      const text = await fs.readFile(path.join(templates, file), 'utf-8');
      expect(text, file).not.toContain('.onVerifyInstDir');
    }
  });

  it('is put right in a macro the template expands in the installer alone, after the page', async () => {
    const lines = (await fs.readFile(path.join(templates, 'assistedInstaller.nsh'), 'utf-8'))
      .split('\n')
      .map((line) => line.trim());
    const page = lines.indexOf('!insertmacro MUI_PAGE_DIRECTORY');
    const ours = lines.indexOf('!insertmacro customPageAfterChangeDir');
    const uninstallerHalf = lines.indexOf('!else');

    expect(lines.indexOf('!ifndef BUILD_UNINSTALLER')).toBeLessThan(page);
    expect(page).toBeGreaterThan(-1);
    expect(ours).toBeGreaterThan(page);
    expect(uninstallerHalf).toBeGreaterThan(ours);
    expect(await macro('customPageAfterChangeDir')).toContain('Function .onVerifyInstDir');
  });

  it('renames with the one rule the step after the page uses', async () => {
    const lines = await macro('customPageAfterChangeDir');
    for (const name of ['ravenForgeNameInstallFolder', '.onVerifyInstDir']) {
      expect(functionIn(lines, name), name).toContain('!insertmacro ravenForgeInstallFolder');
    }
  });

  it('leaves a silent install where it is', async () => {
    // An update runs silently and is asked about its folder as well, once. It
    // stays in the folder it is in.
    const body = functionIn(await macro('customPageAfterChangeDir'), '.onVerifyInstDir');
    expect(body[0]).toBe('${IfNot} ${Silent}');
    expect(body.at(-1)).toBe('${EndIf}');
  });

  it('hands back every register it borrows', async () => {
    // It is called in the middle of whatever the page was doing.
    const body = functionIn(await macro('customPageAfterChangeDir'), '.onVerifyInstDir');
    const of = (word: string) =>
      body.filter((line) => line.startsWith(`${word} `)).map((line) => line.slice(word.length + 1));
    const used = new Set(body.flatMap((line) => line.match(/\$R\d/g) ?? []));
    // The rule itself works in $R0 to $R2.
    for (const register of ['$R0', '$R1', '$R2']) used.add(register);

    expect(of('Push').sort()).toEqual([...used].sort());
    expect(of('Pop')).toEqual(of('Push').reverse());
  });
});
