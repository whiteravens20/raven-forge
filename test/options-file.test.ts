import { describe, it, expect } from 'vitest';
import { buildResourcePacksValue } from '../src/core/minecraft/options-file';

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
