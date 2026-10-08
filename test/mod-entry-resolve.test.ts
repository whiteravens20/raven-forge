// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect, vi } from 'vitest';
import { modEntrySchema, modManifestSchema } from '../src/shared/manifest-schema';

/**
 * A manifest mod given by a direct URL has no API lookup behind it to supply a
 * hash, so the entry's own is the only thing pinning the jar the launcher then
 * loads as code. Requiring it is the mod half of the content-integrity fix:
 * without it a plaintext hop, or an unsigned third-party manifest, could swap
 * the file and nothing downstream would notice.
 */

vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));
vi.mock('../src/main/window', () => ({ getMainWindow: () => null }));

const getModVersions =
  vi.fn<(projectId: string, gameVersion?: string, loaders?: string[]) => unknown>();
vi.mock('../src/core/mods/modrinth-api', async (original) => ({
  ...(await original<typeof import('../src/core/mods/modrinth-api')>()),
  getModVersions: (projectId: string, gameVersion?: string, loaders?: string[]) =>
    getModVersions(projectId, gameVersion, loaders),
}));

const { resolveModEntry } = await import('../src/core/mods/mod-sync');

const manifest = modManifestSchema.parse({
  manifestVersion: 2,
  serverName: 'Ravens',
  minecraftVersion: '1.21.4',
  modLoader: 'fabric',
  mods: [],
});

const urlEntry = (extra: Record<string, unknown>) =>
  modEntrySchema.parse({
    id: 'sodium',
    name: 'Sodium',
    version: '0.6.5',
    source: 'url',
    url: 'https://cdn.example.net/sodium.jar',
    ...extra,
  });

describe('resolveModEntry — a url mod must be hashed', () => {
  it('resolves a url mod that declares a sha512', async () => {
    const resolved = await resolveModEntry(urlEntry({ sha512: 'a'.repeat(128) }), manifest);
    expect(resolved).toMatchObject({
      url: 'https://cdn.example.net/sodium.jar',
      fileName: 'sodium.jar',
    });
  });

  it('accepts sha1 as the floor', async () => {
    const resolved = await resolveModEntry(urlEntry({ sha1: 'b'.repeat(40) }), manifest);
    expect(resolved.fileName).toBe('sodium.jar');
  });

  it('refuses a url mod that declares no hash at all', async () => {
    await expect(resolveModEntry(urlEntry({}), manifest)).rejects.toThrow(/hash/i);
  });
});

/**
 * A manifest entry that names a Modrinth build means that build.
 *
 * A label matching nothing used to be answered with the newest build instead.
 * The profile then ran a different version of the mod from the server its pack
 * was written for, with nothing said — and because no sync would ever install
 * the version the manifest did name, it was counted as behind the pack for good.
 */
describe('resolveModEntry — a Modrinth mod is the build the manifest names', () => {
  const build = (id: string, number: string) => ({
    id,
    version_number: number,
    files: [
      {
        url: `https://cdn.modrinth.com/data/AANobbMI/versions/${id}/sodium-${number}.jar`,
        filename: `sodium-${number}.jar`,
        hashes: { sha512: 'c'.repeat(128), sha1: 'd'.repeat(40) },
        primary: true,
        size: 10,
      },
    ],
  });
  const newest = build('newestId', '0.6.9');
  const pinned = build('pinnedId', '0.6.5');

  const modrinthEntry = (version: string) =>
    modEntrySchema.parse({
      id: 'sodium',
      name: 'Sodium',
      version,
      source: 'modrinth',
      projectId: 'AANobbMI',
    });

  it('finds the build by its version number', async () => {
    getModVersions.mockResolvedValue([newest, pinned]);
    const resolved = await resolveModEntry(modrinthEntry('0.6.5'), manifest);
    expect(resolved.fileName).toBe('sodium-0.6.5.jar');
  });

  it('finds the build by its id as well', async () => {
    getModVersions.mockResolvedValue([newest, pinned]);
    const resolved = await resolveModEntry(modrinthEntry('pinnedId'), manifest);
    expect(resolved.fileName).toBe('sodium-0.6.5.jar');
  });

  it('refuses a label that names no build, rather than taking the newest', async () => {
    getModVersions.mockResolvedValue([newest, pinned]);
    await expect(resolveModEntry(modrinthEntry('0.6.4'), manifest)).rejects.toThrow(
      /Sodium: no Modrinth version "0\.6\.4"/,
    );
  });
});
