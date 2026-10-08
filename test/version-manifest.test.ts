// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Mojang's list of versions and the description of each one, as kept on disk.
 *
 * Every launch starts from these two files. They have to be current — Mojang
 * reissues version descriptions, and the reissue of December 2021 is the one
 * that carries the answer to Log4Shell — and they have to go on working when
 * Mojang cannot be asked.
 */

vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

type Module = typeof import('../src/core/minecraft/version-manifest');

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const META_URL = 'https://piston-meta.mojang.com/v1/packages/abc/1.21.4.json';

const sha1 = (text: string) => crypto.createHash('sha1').update(text).digest('hex');

let root: string;
let mod: Module;
/** URL → what Mojang answers; a missing URL is an unreachable Mojang. */
let mojang: Record<string, string>;
let asked: string[];

const metaText = (mainClass: string) => JSON.stringify({ id: '1.21.4', mainClass });
const manifestFor = (meta: string) =>
  JSON.stringify({
    latest: { release: '1.21.4', snapshot: '1.21.4' },
    versions: [{ id: '1.21.4', type: 'release', url: META_URL, sha1: sha1(meta) }],
  });

const cacheFile = (name: string) => path.join(root, 'cache', name);

/** A fresh module: what the launcher knows right after it started. */
async function restart(): Promise<void> {
  vi.resetModules();
  const { reloadDataRoot } = await import('../src/core/config/data-root');
  reloadDataRoot();
  mod = await import('../src/core/minecraft/version-manifest');
}

/** Make the list on disk older than the launcher trusts unasked. */
async function ageManifest(): Promise<void> {
  const old = new Date(Date.now() - 60 * 60 * 1000);
  await fs.utimes(cacheFile('version_manifest_v2.json'), old, old);
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-version-manifest-'));
  process.env.RAVENFORGE_DATA_DIR = root;
  mojang = {};
  asked = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    asked.push(url);
    const body = mojang[url];
    if (body === undefined) throw new TypeError('fetch failed');
    return new Response(body, { status: 200 });
  });
  await restart();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.RAVENFORGE_DATA_DIR;
  await fs.rm(root, { recursive: true, force: true });
});

describe('the description of a version', () => {
  it('is fetched once and then read from disk', async () => {
    const meta = metaText('net.minecraft.client.main.Main');
    mojang = { [MANIFEST_URL]: manifestFor(meta), [META_URL]: meta };

    expect((await mod.getVersionMeta('1.21.4')).mainClass).toBe('net.minecraft.client.main.Main');
    await mod.getVersionMeta('1.21.4');

    expect(asked.filter((url) => url === META_URL)).toHaveLength(1);
  });

  it('is fetched again when Mojang has reissued it', async () => {
    const first = metaText('first.Main');
    mojang = { [MANIFEST_URL]: manifestFor(first), [META_URL]: first };
    await mod.getVersionMeta('1.21.4');

    const reissued = metaText('reissued.Main');
    mojang = { [MANIFEST_URL]: manifestFor(reissued), [META_URL]: reissued };
    await ageManifest();
    await restart();

    expect((await mod.getVersionMeta('1.21.4')).mainClass).toBe('reissued.Main');
    expect(await fs.readFile(cacheFile('1.21.4.json'), 'utf-8')).toBe(reissued);
  });

  it('is the copy on disk when Mojang cannot be reached at all', async () => {
    const meta = metaText('net.minecraft.client.main.Main');
    mojang = { [MANIFEST_URL]: manifestFor(meta), [META_URL]: meta };
    await mod.getVersionMeta('1.21.4');

    mojang = {};
    await ageManifest();
    await restart();

    expect((await mod.getVersionMeta('1.21.4')).mainClass).toBe('net.minecraft.client.main.Main');
  });

  it('is the copy on disk when the reissue cannot be fetched', async () => {
    const first = metaText('first.Main');
    mojang = { [MANIFEST_URL]: manifestFor(first), [META_URL]: first };
    await mod.getVersionMeta('1.21.4');

    mojang = { [MANIFEST_URL]: manifestFor(metaText('reissued.Main')) };
    await ageManifest();
    await restart();

    expect((await mod.getVersionMeta('1.21.4')).mainClass).toBe('first.Main');
  });

  it('is refused when it is not the file the list names, and nothing is kept', async () => {
    const meta = metaText('net.minecraft.client.main.Main');
    mojang = { [MANIFEST_URL]: manifestFor(meta), [META_URL]: metaText('someone.Else') };

    await expect(mod.getVersionMeta('1.21.4')).rejects.toThrow(/not the file Mojang/);
    await expect(fs.access(cacheFile('1.21.4.json'))).rejects.toThrow();
  });

  it('can be read from disk without asking anyone, for the profile editor', async () => {
    expect(await mod.getCachedVersionMeta('1.21.4')).toBeUndefined();

    const meta = metaText('net.minecraft.client.main.Main');
    mojang = { [MANIFEST_URL]: manifestFor(meta), [META_URL]: meta };
    await mod.getVersionMeta('1.21.4');
    asked.length = 0;

    expect((await mod.getCachedVersionMeta('1.21.4'))?.id).toBe('1.21.4');
    expect(asked).toEqual([]);
  });
});

describe('the list of versions', () => {
  it('is the copy on disk, however old, when Mojang cannot be reached', async () => {
    const meta = metaText('net.minecraft.client.main.Main');
    mojang = { [MANIFEST_URL]: manifestFor(meta) };
    await mod.getVersionManifest();

    mojang = {};
    await ageManifest();
    await restart();

    expect((await mod.getVersionManifest()).versions.map((v) => v.id)).toEqual(['1.21.4']);
  });

  it('does not ask again straight after failing to', async () => {
    const meta = metaText('net.minecraft.client.main.Main');
    mojang = { [MANIFEST_URL]: manifestFor(meta) };
    await mod.getVersionManifest();
    mojang = {};
    await ageManifest();
    await restart();
    asked.length = 0;

    await mod.getVersionManifest();
    await mod.getVersionManifest();

    expect(asked).toHaveLength(1);
  });

  it('fails when there has never been one and there is no network', async () => {
    await expect(mod.getVersionManifest()).rejects.toThrow(/fetch failed/);
  });
});
