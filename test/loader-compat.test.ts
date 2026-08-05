import { describe, it, expect } from 'vitest';
import {
  forgeVersionsFor,
  neoForgePrefix,
  neoForgeVersionsFor,
  isNeoForgeStable,
  isLegacyNeoForge,
} from '../src/core/modloader/forge-installer';

/**
 * Which loader builds a Minecraft version may use.
 *
 * Getting this wrong is not a crash — it is an install that completes and then
 * a game that will not start, so the cases below are all about the boundary
 * between adjacent Minecraft versions.
 */

describe('forgeVersionsFor', () => {
  const all = [
    '1.21-51.0.33',
    '1.21.1-52.0.1',
    '1.21.4-54.1.6',
    '1.21.4-54.1.17',
    '1.21.11-61.1.14',
    '26.1-62.0.0',
    '26.2-65.1.0',
  ];

  it('matches the Minecraft version exactly and strips it', () => {
    expect(forgeVersionsFor(all, '1.21.4')).toEqual(['54.1.6', '54.1.17']);
  });

  it('does not let 1.21 swallow 1.21.1 or 1.21.11', () => {
    expect(forgeVersionsFor(all, '1.21')).toEqual(['51.0.33']);
  });

  it('handles the year-based Minecraft scheme', () => {
    expect(forgeVersionsFor(all, '26.2')).toEqual(['65.1.0']);
    expect(forgeVersionsFor(all, '26.1')).toEqual(['62.0.0']);
  });

  it('returns nothing for a version Forge does not build for', () => {
    expect(forgeVersionsFor(all, '1.21.9')).toEqual([]);
  });
});

describe('neoForgePrefix', () => {
  it('drops the leading 1. and pads a missing patch under the old scheme', () => {
    expect(neoForgePrefix('1.21.4')).toBe('21.4.');
    expect(neoForgePrefix('1.21')).toBe('21.0.');
    expect(neoForgePrefix('1.21.11')).toBe('21.11.');
    expect(neoForgePrefix('1.20.1')).toBe('20.1.');
  });

  it('keeps the version whole and pads to three parts under the year scheme', () => {
    expect(neoForgePrefix('26.2')).toBe('26.2.0.');
    expect(neoForgePrefix('26.1.2')).toBe('26.1.2.');
  });

  it('always ends in a dot', () => {
    // Load-bearing: '21.1' as a prefix matches every 21.1x build.
    for (const mc of ['1.21', '1.21.1', '26.2', '26.1.2']) {
      expect(neoForgePrefix(mc).endsWith('.')).toBe(true);
    }
  });
});

describe('neoForgeVersionsFor', () => {
  const all = [
    '21.0.167',
    '21.1.100',
    '21.4.157',
    '21.10.63',
    '21.11.45',
    '26.1.2.94',
    '26.2.0.46-beta',
  ];

  it('selects only the builds for that Minecraft version', () => {
    expect(neoForgeVersionsFor(all, '1.21.4')).toEqual(['21.4.157']);
    expect(neoForgeVersionsFor(all, '1.21')).toEqual(['21.0.167']);
  });

  it('does not let 1.21.1 pick up 1.21.10 or 1.21.11 builds', () => {
    // Without the trailing dot in the prefix, '21.1' matches '21.10.63' and
    // '21.11.45' — an install that produces a game for the wrong version.
    expect(neoForgeVersionsFor(all, '1.21.1')).toEqual(['21.1.100']);
  });

  it('handles the year-based scheme, including an implied .0 patch', () => {
    expect(neoForgeVersionsFor(all, '26.2')).toEqual(['26.2.0.46-beta']);
    expect(neoForgeVersionsFor(all, '26.1.2')).toEqual(['26.1.2.94']);
  });

  it('returns nothing for Minecraft versions NeoForge never supported', () => {
    // 1.20.1 is empty *here* on purpose: it lives under the legacy artifact,
    // which getNeoForgeVersions falls back to.
    expect(neoForgeVersionsFor(all, '1.20.1')).toEqual([]);
    expect(neoForgeVersionsFor(all, '1.16.5')).toEqual([]);
  });
});

describe('isLegacyNeoForge', () => {
  it('recognises a 1.20.1 build, which is named Forge-style', () => {
    // `47.1.106` does not start with 1.20.1's encoded prefix `20.1.`, which is
    // what distinguishes the two Maven artifacts at install time.
    expect(isLegacyNeoForge('47.1.106', '1.20.1')).toBe(true);
    expect(isLegacyNeoForge('47.1.7', '1.20.1')).toBe(true);
  });

  it('recognises a modern build under either Minecraft scheme', () => {
    expect(isLegacyNeoForge('21.4.157', '1.21.4')).toBe(false);
    expect(isLegacyNeoForge('21.0.167', '1.21')).toBe(false);
    expect(isLegacyNeoForge('26.2.0.46-beta', '26.2')).toBe(false);
    expect(isLegacyNeoForge('26.1.2.94', '26.1.2')).toBe(false);
  });
});

describe('isNeoForgeStable', () => {
  it('treats a plain version as stable', () => {
    expect(isNeoForgeStable('21.4.157')).toBe(true);
    expect(isNeoForgeStable('26.1.2.94')).toBe(true);
  });

  it('treats alpha, beta and rc builds as unstable', () => {
    expect(isNeoForgeStable('26.2.0.46-beta')).toBe(false);
    expect(isNeoForgeStable('21.4.0-beta')).toBe(false);
    expect(isNeoForgeStable('26.1.0.0-alpha.1+snapshot-1')).toBe(false);
    expect(isNeoForgeStable('20.4.100-rc1')).toBe(false);
  });
});
