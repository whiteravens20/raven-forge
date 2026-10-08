// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect } from 'vitest';
import { isAllocatableRam, isManifestUrl, isServerPort } from '../src/shared/profile-draft';
import { profileSchema } from '../src/shared/validators';
import { MAX_RAM_MB, MIN_RAM_MB } from '../src/shared/constants';

/**
 * The profile form's own checks.
 *
 * They have to agree with the schema the main process saves a profile through:
 * a form that lets through what the schema refuses is how a profile used to
 * vanish on Save, and one that refuses what the schema takes locks a field for
 * no reason. So each case is put to both.
 */
const base = {
  id: 'p1',
  name: 'Ravens',
  minecraftVersion: '1.21.4',
  modLoader: 'fabric',
  allocatedRamMb: 4096,
  createdAt: '2026-10-06T00:00:00.000Z',
  updatedAt: '2026-10-06T00:00:00.000Z',
};
const accepts = (extra: Record<string, unknown>) =>
  profileSchema.safeParse({ ...base, ...extra }).success;

describe('isManifestUrl', () => {
  it.each(['https://packs.example.net/manifest.json', 'http://127.0.0.1:8080/manifest.json'])(
    'takes %s, as the schema does',
    (url) => {
      expect(isManifestUrl(url)).toBe(true);
      expect(accepts({ manifestUrl: url })).toBe(true);
    },
  );

  it.each(['example.com/pack.json', 'manifest.json', ''])(
    'refuses %j, as the schema does',
    (url) => {
      expect(isManifestUrl(url)).toBe(false);
      expect(accepts({ manifestUrl: url })).toBe(false);
    },
  );

  it('refuses an address nothing could be fetched from, which the schema lets by', () => {
    // The schema asks only that it parses. A sync would refuse it later, with
    // the profile already saved; the form says so before that.
    for (const url of ['ftp://example.com/manifest.json', 'file:///etc/passwd']) {
      expect(isManifestUrl(url), url).toBe(false);
    }
  });
});

describe('isServerPort', () => {
  it.each([1, 25565, 65535])('takes %d, as the schema does', (port) => {
    expect(isServerPort(port)).toBe(true);
    expect(accepts({ serverPort: port })).toBe(true);
  });

  it.each([0, -1, 65536, 70000])('refuses %d, as the schema does', (port) => {
    expect(isServerPort(port)).toBe(false);
    expect(accepts({ serverPort: port })).toBe(false);
  });

  it('refuses a fraction and a number that is not one', () => {
    expect(isServerPort(25565.5)).toBe(false);
    expect(isServerPort(Number.NaN)).toBe(false);
  });
});

describe('isAllocatableRam', () => {
  it.each([MIN_RAM_MB, 4096, MAX_RAM_MB])('takes %d MB, as the schema does', (mb) => {
    expect(isAllocatableRam(mb)).toBe(true);
    expect(accepts({ allocatedRamMb: mb })).toBe(true);
  });

  it.each([0, 256, MIN_RAM_MB - 1, MAX_RAM_MB + 1])('refuses %d MB, as the schema does', (mb) => {
    expect(isAllocatableRam(mb)).toBe(false);
    expect(accepts({ allocatedRamMb: mb })).toBe(false);
  });

  it('refuses what an emptied box turns into', () => {
    expect(isAllocatableRam(Number.NaN)).toBe(false);
  });
});
