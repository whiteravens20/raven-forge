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
