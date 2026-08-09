import { describe, it, expect } from 'vitest';
import { pendingChanges } from '../src/core/mods/pack-diff';
import type { ModEntry } from '../src/shared/manifest-schema';
import type { InstalledMod } from '../src/shared/ipc-types';

/**
 * The number behind the profile badge. It has to be the same number a sync
 * would act on, or the badge and the Sync button tell the player different
 * stories about the same profile.
 */

const entry = (id: string, version: string, side: ModEntry['side'] = 'client'): ModEntry =>
  ({
    id,
    name: id,
    version,
    source: 'url',
    url: `https://example.test/${id}-${version}.jar`,
    fileName: `${id}-${version}.jar`,
    required: true,
    side,
  }) as ModEntry;

const installed = (id: string, version: string, fromManifest = true): InstalledMod =>
  ({
    id,
    name: id,
    version,
    source: 'url',
    fileName: `${id}-${version}.jar`,
    required: true,
    side: 'client',
    enabled: true,
    fromManifest,
  }) as InstalledMod;

describe('pendingChanges', () => {
  it('counts nothing when the profile already matches the pack', () => {
    const mods = [entry('sodium', '1.0'), entry('jei', '30.16')];
    expect(pendingChanges(mods, [installed('sodium', '1.0'), installed('jei', '30.16')])).toBe(0);
  });

  it('counts a mod the pack bumped', () => {
    const mods = [entry('sodium', '1.0'), entry('jei', '30.17')];
    expect(pendingChanges(mods, [installed('sodium', '1.0'), installed('jei', '30.16')])).toBe(1);
  });

  it('counts a mod the pack added', () => {
    const mods = [entry('sodium', '1.0'), entry('modonomicon', '2.4.0')];
    expect(pendingChanges(mods, [installed('sodium', '1.0')])).toBe(1);
  });

  it('counts a mod the pack dropped', () => {
    expect(
      pendingChanges(
        [entry('sodium', '1.0')],
        [installed('sodium', '1.0'), installed('optifine', '1.0')],
      ),
    ).toBe(1);
  });

  it('leaves a mod the player installed by hand out of it', () => {
    // Not the pack's to remove, so a sync would not touch it and the badge must
    // not offer to.
    const mods = [entry('sodium', '1.0')];
    expect(
      pendingChanges(mods, [installed('sodium', '1.0'), installed('shulkerbox', '3.0', false)]),
    ).toBe(0);
  });

  it('ignores server-only entries, which a profile never installs', () => {
    const mods = [entry('sodium', '1.0'), entry('luckperms', '5.5', 'server')];
    expect(pendingChanges(mods, [installed('sodium', '1.0')])).toBe(0);
  });

  it('counts a `both` entry, which a profile does install', () => {
    const mods = [entry('modonomicon', '2.4.0', 'both')];
    expect(pendingChanges(mods, [])).toBe(1);
  });

  it('counts every difference at once', () => {
    // One bumped, one added, one dropped — the real shape of a pack release.
    const mods = [entry('sodium', '2.0'), entry('modonomicon', '2.4.0')];
    const have = [installed('sodium', '1.0'), installed('optifine', '1.0')];
    expect(pendingChanges(mods, have)).toBe(3);
  });

  it('counts an empty profile as needing the whole pack', () => {
    expect(pendingChanges([entry('a', '1'), entry('b', '1')], [])).toBe(2);
  });
});
