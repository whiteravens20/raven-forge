// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { applyProfileOptions, buildResourcePacksValue } from '../src/core/minecraft/options-file';

/**
 * The one thing here that can be wrong quietly: the direction.
 *
 * `options.txt` stores the *loading* order — lowest priority first, last entry
 * wins, which is why `"vanilla"` heads the line — while the launcher's list is
 * highest priority first. Reverse it the wrong way and every pack still loads,
 * every hash still matches, and the player simply gets the wrong textures.
 */
describe('buildResourcePacksValue', () => {
  it('reverses the launcher order so the top of the UI wins in game', () => {
    const value = buildResourcePacksValue('["vanilla"]', ['top.zip', 'middle.zip', 'bottom.zip']);
    expect(JSON.parse(value)).toEqual([
      'vanilla',
      'file/bottom.zip',
      'file/middle.zip',
      'file/top.zip',
    ]);
  });

  it('keeps vanilla first when the file has never been written', () => {
    expect(JSON.parse(buildResourcePacksValue(null, ['only.zip']))).toEqual([
      'vanilla',
      'file/only.zip',
    ]);
  });

  it('preserves entries the launcher does not manage, below its own', () => {
    // A modpack's built-in packs must survive a reorder — dropping them
    // silently unselects the mod resources the profile needs.
    const value = buildResourcePacksValue('["vanilla","mod_resources","quark:emote_resources"]', [
      'user.zip',
    ]);
    expect(JSON.parse(value)).toEqual([
      'vanilla',
      'mod_resources',
      'quark:emote_resources',
      'file/user.zip',
    ]);
  });

  it('replaces its own previous entries rather than appending duplicates', () => {
    const first = buildResourcePacksValue('["vanilla"]', ['a.zip', 'b.zip']);
    const second = buildResourcePacksValue(first, ['b.zip', 'a.zip']);
    expect(JSON.parse(second)).toEqual(['vanilla', 'file/a.zip', 'file/b.zip']);
  });

  it('recognises a bare file name as its own, not as a foreign entry', () => {
    // Pre-1.13 profiles list folder packs without the file/ prefix. Treating
    // one as foreign would leave the pack listed twice, at two priorities.
    const value = buildResourcePacksValue('["vanilla","old.zip"]', ['old.zip']);
    expect(JSON.parse(value)).toEqual(['vanilla', 'file/old.zip']);
  });

  it('keeps a pack the player put in the folder and switched on in the game', () => {
    // This runs before every launch of a pack profile. It used to take every
    // folder entry it did not know out of the line, so a pack dropped into
    // `resourcepacks/` by hand was switched off again each time the game started.
    const value = buildResourcePacksValue(
      '["vanilla","mod_resources","file/MyOwnPack.zip","file/pack-shipped.zip"]',
      ['pack-shipped.zip'],
      new Set(['MyOwnPack.zip']),
    );
    expect(JSON.parse(value)).toEqual([
      'vanilla',
      'mod_resources',
      'file/MyOwnPack.zip',
      'file/pack-shipped.zip',
    ]);
  });

  it('still drops an entry for a file that is no longer in the folder', () => {
    // Which is what a pack removed in the launcher is.
    const value = buildResourcePacksValue('["vanilla","file/removed.zip"]', [], new Set());
    expect(JSON.parse(value)).toEqual(['vanilla']);
  });

  it('does not keep a pack the launcher holds switched off', () => {
    // It is in the folder, and it is not the player's: the launcher's list is
    // what says whether it is on, so it is never passed as hand-placed.
    const value = buildResourcePacksValue('["vanilla","file/off.zip"]', [], new Set());
    expect(JSON.parse(value)).toEqual(['vanilla']);
  });

  it('drops every managed pack when the list is emptied', () => {
    const value = buildResourcePacksValue('["vanilla","file/gone.zip","mod_resources"]', []);
    expect(JSON.parse(value)).toEqual(['vanilla', 'mod_resources']);
  });

  it('falls back to vanilla when the existing value is not parseable', () => {
    expect(JSON.parse(buildResourcePacksValue('not json', ['x.zip']))).toEqual([
      'vanilla',
      'file/x.zip',
    ]);
  });
});

/**
 * The half of the full-screen setting that the command line cannot do.
 *
 * `--fullscreen` turns it on, the game saves that into `options.txt` on exit,
 * and there is no argument that turns it back off — so a profile switched back
 * to windowed would have kept starting full-screen for ever. Stating the value
 * in the file the game reads is what makes the choice work in both directions,
 * and these cases are the ones where getting it wrong is silent.
 */
describe('the full-screen choice of a profile', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-options-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const optionsFile = () => path.join(dir, 'options.txt');
  const read = () => fs.readFile(optionsFile(), 'utf-8');

  it('writes a one-line file for a profile that has never launched', async () => {
    await applyProfileOptions(dir, { fullscreen: true });
    expect(await read()).toBe('fullscreen:true\n');
  });

  it('overrules what the last session saved', async () => {
    // F11 during play, then quit: the game leaves `fullscreen:true` behind. A
    // profile that says windowed has to be able to mean it a second time.
    await fs.writeFile(optionsFile(), 'version:3465\nfullscreen:true\nfov:0.0\n');
    await applyProfileOptions(dir, { fullscreen: false });
    expect(await read()).toBe('version:3465\nfullscreen:false\nfov:0.0\n');
  });

  it('leaves every other setting exactly as the player left it', async () => {
    const body = 'lang:pl_pl\nresourcePacks:["vanilla"]\nkey_key.attack:key.mouse.left\n';
    await fs.writeFile(optionsFile(), body);
    await applyProfileOptions(dir, { fullscreen: true });
    expect(await read()).toBe(body + 'fullscreen:true\n');
  });

  it('does not touch the file when it already says so', async () => {
    await fs.writeFile(optionsFile(), 'fullscreen:true\n');
    const before = (await fs.stat(optionsFile())).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 10));
    await applyProfileOptions(dir, { fullscreen: true });
    expect((await fs.stat(optionsFile())).mtimeMs).toBe(before);
  });
});

/**
 * The game's language, which it reads from this file and from nowhere else.
 *
 * There is no launch argument for it, so a profile that names a language has
 * exactly one way to make the game use it.
 */
describe('the language of a profile', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-options-lang-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const optionsFile = () => path.join(dir, 'options.txt');
  const read = () => fs.readFile(optionsFile(), 'utf-8');

  it('gives a profile that has never launched its language from the first start', async () => {
    await applyProfileOptions(dir, { language: 'pl_pl' });
    expect(await read()).toBe('lang:pl_pl\n');
  });

  it('replaces the language the last session left, and nothing else', async () => {
    await fs.writeFile(optionsFile(), 'version:3465\nlang:en_us\nfov:0.0\n');
    await applyProfileOptions(dir, { language: 'de_de' });
    expect(await read()).toBe('version:3465\nlang:de_de\nfov:0.0\n');
  });

  it('does not rewrite a file that already says the same thing', async () => {
    await fs.writeFile(optionsFile(), 'lang:pl_pl\n');
    const before = (await fs.stat(optionsFile())).mtimeMs;
    await applyProfileOptions(dir, { language: 'pl_pl' });
    expect((await fs.stat(optionsFile())).mtimeMs).toBe(before);
  });
});

/**
 * The file is the player's, written by the game, and on Windows it looks
 * different from what the launcher would write by itself.
 */
describe('the file as the game leaves it', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-options-file-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const optionsFile = () => path.join(dir, 'options.txt');
  const read = () => fs.readFile(optionsFile(), 'utf-8');

  it('is not rewritten when it has Windows line endings and already says so', async () => {
    await fs.writeFile(optionsFile(), 'version:3465\r\nfullscreen:true\r\nlang:pl_pl\r\n');
    const before = (await fs.stat(optionsFile())).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 10));

    await applyProfileOptions(dir, { fullscreen: true, language: 'pl_pl' });

    expect((await fs.stat(optionsFile())).mtimeMs).toBe(before);
  });

  it('keeps its Windows line endings on every line when a value changes', async () => {
    await fs.writeFile(optionsFile(), 'version:3465\r\nfullscreen:true\r\nfov:0.0\r\n');

    await applyProfileOptions(dir, { fullscreen: false, language: 'pl_pl' });

    expect(await read()).toBe('version:3465\r\nfullscreen:false\r\nfov:0.0\r\nlang:pl_pl\r\n');
  });

  it('gets both choices in one write', async () => {
    await applyProfileOptions(dir, { fullscreen: true, language: 'pl_pl' });
    expect(await read()).toBe('fullscreen:true\nlang:pl_pl\n');
  });

  it('is left alone by a profile that chooses nothing', async () => {
    await applyProfileOptions(dir, {});
    await expect(fs.access(optionsFile())).rejects.toThrow();
  });

  it('is not replaced when it could not be read', async () => {
    // A folder where the file belongs is the portable way to make the read
    // fail with something other than "not there". What used to follow was a
    // one-line file renamed over the player's settings.
    await fs.mkdir(optionsFile());

    await expect(applyProfileOptions(dir, { fullscreen: true })).rejects.toThrow();

    expect((await fs.stat(optionsFile())).isDirectory()).toBe(true);
    expect(await fs.readdir(dir)).toEqual(['options.txt']);
  });
});
