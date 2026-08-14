import { describe, it, expect } from 'vitest';
import { activeSkinUrl } from '../src/core/auth/microsoft-auth';

/**
 * The skin URL the profile endpoint returns is not usable as-is.
 *
 * Reported as: a Microsoft account signs in and appears in the launcher, but its
 * avatar renders as a broken image. Mojang returns the texture over plain
 * `http://`, and the renderer runs under `img-src 'self' data: https:`, so the
 * browser declined to load it. Nothing in the auth chain failed, which is why
 * the account looked fine apart from the picture.
 */
describe('resolving the account skin', () => {
  it('upgrades the http URL Mojang returns, so the renderer is allowed to load it', () => {
    expect(
      activeSkinUrl({
        id: 'x',
        name: 'x',
        skins: [{ url: 'http://textures.minecraft.net/texture/abc', state: 'ACTIVE' }],
      }),
    ).toBe('https://textures.minecraft.net/texture/abc');
  });

  it('leaves an already-secure URL alone', () => {
    const url = 'https://textures.minecraft.net/texture/abc';
    expect(activeSkinUrl({ id: 'x', name: 'x', skins: [{ url, state: 'ACTIVE' }] })).toBe(url);
  });

  it('rewrites only the scheme, never a later occurrence in the path', () => {
    expect(
      activeSkinUrl({
        id: 'x',
        name: 'x',
        skins: [{ url: 'http://example.test/http://not-a-scheme', state: 'ACTIVE' }],
      }),
    ).toBe('https://example.test/http://not-a-scheme');
  });

  it('picks the skin being worn rather than the first ever uploaded', () => {
    // The array is every skin on the account; exactly one is ACTIVE, and it is
    // not reliably first. Taking [0] shows a texture the player has replaced.
    expect(
      activeSkinUrl({
        id: 'x',
        name: 'x',
        skins: [
          { url: 'https://textures.minecraft.net/texture/old', state: 'INACTIVE' },
          { url: 'https://textures.minecraft.net/texture/worn', state: 'ACTIVE' },
        ],
      }),
    ).toBe('https://textures.minecraft.net/texture/worn');
  });

  it('falls back to the first skin when none is marked active', () => {
    // Defensive: `state` is not guaranteed by anything we control, and a skin we
    // are unsure about still beats the initial-letter placeholder.
    expect(
      activeSkinUrl({
        id: 'x',
        name: 'x',
        skins: [{ url: 'https://textures.minecraft.net/texture/only' }],
      }),
    ).toBe('https://textures.minecraft.net/texture/only');
  });

  it('reports no skin rather than an empty one, so the page draws its placeholder', () => {
    expect(activeSkinUrl({ id: 'x', name: 'x' })).toBeUndefined();
    expect(activeSkinUrl({ id: 'x', name: 'x', skins: [] })).toBeUndefined();
  });
});
