import { describe, it, expect } from 'vitest';
import { tagLabel, loaderLabel } from '../src/shared/labels';

/**
 * Modrinth's tags are facet keys first and labels second. The rule has to
 * capitalise `game-mechanics` without mangling `8x-`, where the trailing
 * punctuation is the meaning rather than a word break.
 */
describe('tagLabel', () => {
  it.each([
    ['adventure', 'Adventure'],
    ['game-mechanics', 'Game mechanics'],
    ['vanilla-like', 'Vanilla like'],
    ['path-tracing', 'Path tracing'],
    ['colored-lighting', 'Colored lighting'],
    ['core-shaders', 'Core shaders'],
  ])('%s → %s', (input, expected) => expect(tagLabel(input)).toBe(expected));

  it.each(['512x+', '8x-', '16x', '128x'])('leaves the resolution %s intact', (res) => {
    // `8x-` must not become `8x ` — only hyphens *between* word characters are
    // word breaks.
    expect(tagLabel(res)).toBe(res);
  });

  it.each([
    ['neoforge', 'NeoForge'],
    ['optifine', 'OptiFine'],
    ['pbr', 'PBR'],
    ['gui', 'GUI'],
    ['worldgen', 'World generation'],
  ])('special-cases %s, which the mechanical rule gets wrong', (input, expected) =>
    expect(tagLabel(input)).toBe(expected),
  );

  it.each([
    ['fabric', 'Fabric'],
    ['forge', 'Forge'],
    ['quilt', 'Quilt'],
    ['iris', 'Iris'],
    ['canvas', 'Canvas'],
  ])('needs no special case for %s', (input, expected) =>
    expect(tagLabel(input)).toBe(expected),
  );

  it('does not throw on an empty tag', () => {
    expect(tagLabel('')).toBe('');
  });

  it('passes through a tag Modrinth adds tomorrow', () => {
    // The point of the mechanical rule: an unknown tag reads sensibly rather
    // than vanishing or arriving as a raw key.
    expect(tagLabel('ray-reconstruction')).toBe('Ray reconstruction');
  });
});

/** A profile stores its loader lowercase; nothing on screen should say so. */
describe('loaderLabel', () => {
  it.each([
    ['vanilla', 'Vanilla'],
    ['fabric', 'Fabric'],
    ['quilt', 'Quilt'],
    ['forge', 'Forge'],
    ['neoforge', 'NeoForge'],
  ])('%s → %s', (input, expected) => expect(loaderLabel(input)).toBe(expected));
});
