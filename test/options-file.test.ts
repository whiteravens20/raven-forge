import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { applyFullscreen, buildResourcePacksValue } from '../src/core/minecraft/options-file';

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
describe('applyFullscreen', () => {
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
    await applyFullscreen(dir, true);
    expect(await read()).toBe('fullscreen:true\n');
  });

  it('overrules what the last session saved', async () => {
    // F11 during play, then quit: the game leaves `fullscreen:true` behind. A
    // profile that says windowed has to be able to mean it a second time.
    await fs.writeFile(optionsFile(), 'version:3465\nfullscreen:true\nfov:0.0\n');
    await applyFullscreen(dir, false);
    expect(await read()).toBe('version:3465\nfullscreen:false\nfov:0.0\n');
  });

  it('leaves every other setting exactly as the player left it', async () => {
    const body = 'lang:pl_pl\nresourcePacks:["vanilla"]\nkey_key.attack:key.mouse.left\n';
    await fs.writeFile(optionsFile(), body);
    await applyFullscreen(dir, true);
    expect(await read()).toBe(body + 'fullscreen:true\n');
  });

  it('does not touch the file when it already says so', async () => {
    await fs.writeFile(optionsFile(), 'fullscreen:true\n');
    const before = (await fs.stat(optionsFile())).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 10));
    await applyFullscreen(dir, true);
    expect((await fs.stat(optionsFile())).mtimeMs).toBe(before);
  });
});
