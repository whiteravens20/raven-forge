// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Profile } from '../src/shared/ipc-types';

/**
 * A modded profile with no loader build chosen.
 *
 * The profile editor used to offer "latest" and save it as nothing at all. The
 * launch then had no version to install and none to read a loader profile for,
 * skipped both, and started plain Minecraft — reported by players as "changing
 * the loader does not install it unless I pick an exact version".
 */

vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

const resolveDefaultLoaderVersion =
  vi.fn<(loader: string, mc: string) => Promise<string | undefined>>();
vi.mock('../src/core/modloader/loader-manager', () => ({
  resolveDefaultLoaderVersion: (loader: string, mc: string) =>
    resolveDefaultLoaderVersion(loader, mc),
  installLoader: vi.fn(),
  isLoaderInstalled: vi.fn(),
}));

const updateProfile = vi.fn(async (id: string, updates: Partial<Profile>) => ({
  ...profile,
  ...updates,
  id,
}));
vi.mock('../src/core/profiles/profile-manager', () => ({
  getProfile: vi.fn(),
  recordPlaySession: vi.fn(),
  updateProfile: (id: string, updates: Partial<Profile>) => updateProfile(id, updates),
}));

const profile: Profile = {
  id: 'p1',
  name: 'Survival',
  minecraftVersion: '1.21.1',
  modLoader: 'neoforge',
  allocatedRamMb: 4096,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const { withLoaderVersion } = await import('../src/core/minecraft/game-launcher');
const { refusalOf } = await import('../src/core/util/refusal');

beforeEach(() => {
  resolveDefaultLoaderVersion.mockReset();
});

describe('withLoaderVersion', () => {
  it('chooses a build and writes it into the profile', async () => {
    resolveDefaultLoaderVersion.mockResolvedValue('21.1.209');

    const ready = await withLoaderVersion(profile);

    expect(resolveDefaultLoaderVersion).toHaveBeenCalledWith('neoforge', '1.21.1');
    expect(ready.modLoaderVersion).toBe('21.1.209');
    // Pinned, so the next launch does not ask again and cannot pick another.
    expect(updateProfile).toHaveBeenCalledWith('p1', { modLoaderVersion: '21.1.209' });
  });

  it('leaves a profile that already names a build alone', async () => {
    const pinned = { ...profile, modLoaderVersion: '21.1.150' };

    expect(await withLoaderVersion(pinned)).toBe(pinned);
    expect(resolveDefaultLoaderVersion).not.toHaveBeenCalled();
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('has nothing to choose for vanilla', async () => {
    const vanilla = { ...profile, modLoader: 'vanilla' as const };

    expect(await withLoaderVersion(vanilla)).toBe(vanilla);
    expect(resolveDefaultLoaderVersion).not.toHaveBeenCalled();
  });

  it('refuses, in words the player can act on, when the loader has no build', async () => {
    resolveDefaultLoaderVersion.mockResolvedValue(undefined);

    const err = await withLoaderVersion(profile).catch((e: unknown) => e);

    // A refusal with a key, not a bare failure: the renderer says this one in
    // the player's language, and it names the two things to go and change.
    expect(refusalOf(err)).toEqual({
      key: 'launchError.loaderVersionUnknown',
      vars: { loader: 'NeoForge', version: '1.21.1' },
    });
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('refuses the same way when the loader cannot be asked', async () => {
    resolveDefaultLoaderVersion.mockRejectedValue(new Error('fetch failed'));

    const err = await withLoaderVersion(profile).catch((e: unknown) => e);

    expect(refusalOf(err)?.key).toBe('launchError.loaderVersionUnknown');
    // The cause stays in the English message, which is what the log records.
    expect((err as Error).message).toMatch(/fetch failed/);
  });
});
