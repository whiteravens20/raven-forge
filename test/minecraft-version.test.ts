// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect } from 'vitest';
import { isReleaseAtLeast, releaseNumber } from '../src/shared/minecraft-version';

/**
 * Where a Minecraft version stands among the releases.
 *
 * What a loader can be installed for is stated as "from this release on", and
 * Minecraft has been numbered two ways — so the comparison has to be one of
 * numbers, and has to know when an id gives it nothing to compare.
 */
describe('releaseNumber', () => {
  it('reads both ways Minecraft has been numbered', () => {
    expect(releaseNumber('1.21.11')).toEqual([1, 21, 11]);
    expect(releaseNumber('26.3')).toEqual([26, 3]);
  });

  it('counts a snapshot named after a release as that release', () => {
    expect(releaseNumber('26.4-snapshot-3')).toEqual([26, 4]);
    expect(releaseNumber('1.21.5-pre1')).toEqual([1, 21, 5]);
  });

  it('has nothing for an id with no release in it', () => {
    expect(releaseNumber('25w14a')).toBeNull();
    expect(releaseNumber('b1.7.3')).toBeNull();
  });
});

describe('isReleaseAtLeast', () => {
  it('compares numbers, not text', () => {
    // As text, "1.7.10" sorts before "1.7.2".
    expect(isReleaseAtLeast('1.7.10', '1.7.2')).toBe(true);
    expect(isReleaseAtLeast('1.7.2', '1.7.10')).toBe(false);
    expect(isReleaseAtLeast('1.21', '1.21.0')).toBe(true);
  });

  it('puts the year-numbered versions after every 1.x', () => {
    expect(isReleaseAtLeast('26.1', '1.21.11')).toBe(true);
    expect(isReleaseAtLeast('1.21.11', '26.1')).toBe(false);
  });

  it('does not guess about an id it cannot place', () => {
    expect(isReleaseAtLeast('25w14a', '1.7.10')).toBeNull();
  });
});
