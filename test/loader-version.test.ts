// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect } from 'vitest';
import {
  compareLoaderVersionsDesc,
  defaultLoaderVersion,
  isPrerelease,
} from '../src/shared/loader-version';

/**
 * Which loader build a profile gets when nobody chose one.
 *
 * This is the rule behind the profile editor's preselected build and behind a
 * launch that finds none set. Getting it wrong is quiet: the profile installs
 * and starts, on a beta nobody asked for.
 */
describe('defaultLoaderVersion', () => {
  it('takes the build the loader recommends over a newer one', () => {
    // Forge: one promoted build per Minecraft version, usually not the newest.
    expect(
      defaultLoaderVersion([
        { version: '47.4.13', stable: true },
        { version: '47.4.10', stable: true, recommended: true },
        { version: '47.4.9', stable: true },
      ]),
    ).toBe('47.4.10');
  });

  it('skips prereleases when nothing is recommended', () => {
    // NeoForge and Quilt name no recommended build.
    expect(
      defaultLoaderVersion([
        { version: '21.4.200-beta', stable: false },
        { version: '21.4.156', stable: true },
      ]),
    ).toBe('21.4.156');
  });

  it('still answers for a Minecraft version that only has prereleases', () => {
    expect(defaultLoaderVersion([{ version: '26.2.0.3-beta', stable: false }])).toBe(
      '26.2.0.3-beta',
    );
  });

  it('has nothing to offer when the loader publishes nothing', () => {
    expect(defaultLoaderVersion([])).toBeUndefined();
  });
});

describe('compareLoaderVersionsDesc', () => {
  it('puts Quilt builds newest first, which the Quilt API does not', () => {
    // The first eight entries of the live list for 1.21.4, as it arrives.
    const asServed = [
      '0.20.0-beta.9',
      '0.20.0-beta.7',
      '0.20.0-beta.8',
      '0.20.0-beta.1',
      '0.20.0-beta.2',
      '0.24.0',
      '0.20.2-beta.1',
      '0.20.0-beta.5',
    ];
    expect([...asServed].sort(compareLoaderVersionsDesc)).toEqual([
      '0.24.0',
      '0.20.2-beta.1',
      '0.20.0-beta.9',
      '0.20.0-beta.8',
      '0.20.0-beta.7',
      '0.20.0-beta.5',
      '0.20.0-beta.2',
      '0.20.0-beta.1',
    ]);
  });

  it('compares components as numbers, not as text', () => {
    expect(['0.9.0', '0.10.0', '0.29.2'].sort(compareLoaderVersionsDesc)).toEqual([
      '0.29.2',
      '0.10.0',
      '0.9.0',
    ]);
  });

  it('puts a release above its own prereleases', () => {
    expect(['0.30.0-beta.2', '0.30.0', '0.30.0-beta.10'].sort(compareLoaderVersionsDesc)).toEqual([
      '0.30.0',
      '0.30.0-beta.10',
      '0.30.0-beta.2',
    ]);
  });
});

describe('isPrerelease', () => {
  it('reads the tag out of the version string', () => {
    expect(isPrerelease('21.4.0-beta')).toBe(true);
    expect(isPrerelease('0.30.0-beta.1')).toBe(true);
    expect(isPrerelease('0.17.0-rc.2')).toBe(true);
    expect(isPrerelease('26.1.0.0-alpha.3+snapshot')).toBe(true);
  });

  it('leaves an ordinary build alone', () => {
    expect(isPrerelease('0.17.2')).toBe(false);
    expect(isPrerelease('21.1.209')).toBe(false);
    // Forge's own build numbering, which has a hyphen-free dotted form.
    expect(isPrerelease('54.1.6')).toBe(false);
  });
});
