import { describe, it, expect } from 'vitest';
import { localized } from '../src/renderer/i18n/localized';

/**
 * A pack summary is written by whoever published the pack, so it can never be
 * a translation key — it arrives as data and has to be chosen from at render
 * time. What is worth pinning down is the order it falls back in, because
 * every step of it is a judgement rather than an obvious default.
 */
describe('localized', () => {
  const map = { pl: 'Klasyczny Minecraft.', en: 'Classic Minecraft.' };

  it('gives the player the language they chose', () => {
    expect(localized(map, 'pl')).toBe('Klasyczny Minecraft.');
    expect(localized(map, 'en')).toBe('Classic Minecraft.');
  });

  it('falls back to English before anything else', () => {
    // Opposite of `translate()`, where English is the last resort. A published
    // map is written for a wider audience than this app's UI.
    expect(localized({ en: 'Classic Minecraft.', de: 'Klassisches Minecraft.' }, 'pl')).toBe(
      'Classic Minecraft.',
    );
  });

  it('shows the wrong language rather than nothing', () => {
    // A summary a player cannot read still says the pack exists and roughly
    // what it is. An empty line says neither.
    expect(localized({ de: 'Klassisches Minecraft.' }, 'pl')).toBe('Klassisches Minecraft.');
  });

  it('takes a plain string as written for everybody', () => {
    expect(localized('Classic Minecraft.', 'pl')).toBe('Classic Minecraft.');
  });

  it('uses the fallback when there is nothing to pick from', () => {
    // The real caller passes the catalogue's flat `summary` here, so a pack
    // published before the map existed still describes itself.
    expect(localized(undefined, 'pl', 'Klasyczny Minecraft.')).toBe('Klasyczny Minecraft.');
    expect(localized({}, 'pl', 'Klasyczny Minecraft.')).toBe('Klasyczny Minecraft.');
    expect(localized(undefined, 'pl')).toBe('');
  });

  it('skips a language published blank', () => {
    // raven-packs drops blank values at build time, but the catalogue is a
    // remote file and this runs on whatever actually arrives.
    expect(localized({ pl: '', en: 'Classic Minecraft.' }, 'pl')).toBe('Classic Minecraft.');
    expect(localized({ pl: '', en: '' }, 'pl', 'fallback')).toBe('fallback');
  });
});
