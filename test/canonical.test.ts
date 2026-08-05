import { describe, it, expect } from 'vitest';
import { canonicalize } from '../src/core/updater/canonical';

/**
 * `canonicalize` is one half of a cross-repo contract — raven-packs'
 * `scripts/lib/canonical.mjs` signs what this verifies. Everything here is
 * about the property that makes a signature mean anything: two manifests
 * produce the same bytes if and only if their *content* is the same.
 */
describe('canonicalize', () => {
  it('is independent of key order', () => {
    const a = { b: 1, a: 2, c: 3 };
    const b = { c: 3, a: 2, b: 1 };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('sorts keys at every nesting level', () => {
    // The bug this exists to prevent: an allowlist-style sort left nested
    // objects serialized as {}, so a manifest whose every mod had been swapped
    // for a backdoored jar still verified.
    const a = { mods: [{ url: 'https://cdn/a.jar', name: 'a', sha512: 'aaa' }] };
    const b = { mods: [{ name: 'a', sha512: 'aaa', url: 'https://cdn/a.jar' }] };

    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(canonicalize(a)).toContain('https://cdn/a.jar');
    expect(canonicalize(a)).toContain('aaa');
  });

  it('sorts keys inside objects nested in arrays nested in objects', () => {
    const deep = {
      z: { y: [{ b: [{ d: 1, c: 2 }], a: 3 }] },
      a: 1,
    };
    expect(canonicalize(deep)).toBe('{"a":1,"z":{"y":[{"a":3,"b":[{"c":2,"d":1}]}]}}');
  });

  it('excludes the signature field from its own message', () => {
    const unsigned = { name: 'pack', mods: [] };
    const signed = { ...unsigned, signature: 'AAAA' };
    expect(canonicalize(signed)).toBe(canonicalize(unsigned));
  });

  it('changes when any nested value changes', () => {
    const base = { mods: [{ name: 'a', url: 'https://cdn/a.jar' }] };
    const swappedUrl = { mods: [{ name: 'a', url: 'https://evil/a.jar' }] };
    const appended = { mods: [...base.mods, { name: 'b', url: 'https://cdn/b.jar' }] };

    expect(canonicalize(swappedUrl)).not.toBe(canonicalize(base));
    expect(canonicalize(appended)).not.toBe(canonicalize(base));
  });

  it('preserves array order — a reordered mod list is a different manifest', () => {
    const a = { mods: [{ n: 1 }, { n: 2 }] };
    const b = { mods: [{ n: 2 }, { n: 1 }] };
    expect(canonicalize(a)).not.toBe(canonicalize(b));
  });

  it('distinguishes null from an absent key', () => {
    expect(canonicalize({ a: null })).not.toBe(canonicalize({}));
  });

  it('distinguishes a number from its string form', () => {
    expect(canonicalize({ v: 2 })).not.toBe(canonicalize({ v: '2' }));
  });

  it('keeps unicode intact rather than escaping it inconsistently', () => {
    // Both sides must agree on the escaping; JSON.stringify's own is the
    // contract, so pin it.
    expect(canonicalize({ name: 'Raven MC — ąćęł' })).toBe('{"name":"Raven MC — ąćęł"}');
  });
});
