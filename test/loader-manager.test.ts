// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defaultLoaderVersion } from '../src/shared/loader-version';

/**
 * What the loader list says, and what counts as an installed loader.
 *
 * Both feed a decision that is made without anyone watching: which build an
 * unpinned profile gets, and whether a launch installs the loader or assumes it
 * is there.
 */

vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

let root: string;
type LoaderManager = typeof import('../src/core/modloader/loader-manager');
let mod: LoaderManager;

function serve(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  );
}

/**
 * Forge's two addresses: the Maven list of every build for every Minecraft
 * version, in the order given, and the promotions feed — `null` for a feed
 * that cannot be reached.
 */
function serveForge(builds: string[], promos: Record<string, string> | null): void {
  const versions = builds.map((build) => `<version>${build}</version>`).join('');
  const xml = `<metadata><versioning><versions>${versions}</versions></versioning></metadata>`;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      if (String(url).endsWith('/maven-metadata.xml')) return new Response(xml, { status: 200 });
      return promos
        ? new Response(JSON.stringify({ promos }), { status: 200 })
        : new Response('unavailable', { status: 503 });
    }),
  );
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-loader-manager-'));
  process.env.RAVENFORGE_DATA_DIR = root;
  vi.resetModules();
  const { reloadDataRoot } = await import('../src/core/config/data-root');
  reloadDataRoot();
  mod = await import('../src/core/modloader/loader-manager');
});

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.RAVENFORGE_DATA_DIR;
  await fs.rm(root, { recursive: true, force: true });
});

describe('getLoaderVersions', () => {
  it('sorts Quilt, whose list arrives in no order, and marks its betas', async () => {
    serve(
      ['0.20.0-beta.9', '0.20.0-beta.7', '0.24.0', '0.29.2', '0.30.0-beta.1'].map((version) => ({
        loader: { version },
      })),
    );

    const versions = await mod.getLoaderVersions('quilt', '1.21.4');

    expect(versions.map((v) => v.version)).toEqual([
      '0.30.0-beta.1',
      '0.29.2',
      '0.24.0',
      '0.20.0-beta.9',
      '0.20.0-beta.7',
    ]);
    expect(versions.find((v) => v.version === '0.30.0-beta.1')?.stable).toBe(false);
    // The first entry as served was a two-year-old beta; this is what an
    // unpinned Quilt profile gets instead.
    expect(defaultLoaderVersion(versions)).toBe('0.29.2');
  });

  it("reads Fabric's single flagged build as the recommended one, not the only stable one", async () => {
    serve([
      { loader: { version: '0.19.5', stable: true } },
      { loader: { version: '0.19.4', stable: false } },
      { loader: { version: '0.19.3', stable: false } },
    ]);

    const versions = await mod.getLoaderVersions('fabric', '1.21.4');

    expect(versions.map((v) => v.recommended)).toEqual([true, false, false]);
    // Every one of them is finished software; the editor used to label all but
    // the first "unstable".
    expect(versions.every((v) => v.stable)).toBe(true);
  });

  it('sorts Forge newest first when its list arrives that way round already', async () => {
    // Minecraft 1.21, in the order Forge's Maven serves it. The list used to be
    // reversed on the theory that Maven lists oldest first.
    serveForge(['1.21-51.0.33', '1.21-51.0.32', '1.21-51.0.1', '1.21-51.0.0', '1.21.1-52.0.1'], {
      '1.21-latest': '51.0.33',
    });

    const versions = await mod.getLoaderVersions('forge', '1.21');

    expect(versions.map((v) => v.version)).toEqual(['51.0.33', '51.0.32', '51.0.1', '51.0.0']);
    // Forge recommends no build for 1.21, so the head of the list is what an
    // unpinned profile is given — and then keeps.
    expect(defaultLoaderVersion(versions)).toBe('51.0.33');
  });

  it('sorts a Forge list that runs one way and then the other', async () => {
    // Minecraft 1.20.1: newest-first down to the very first build, then the
    // later ones appended oldest-first. And the promotions feed is down.
    serveForge(
      [
        '1.20.1-47.4.5',
        '1.20.1-47.4.4',
        '1.20.1-47.0.0',
        '1.20.1-47.4.10',
        '1.20.1-47.4.25',
        '1.20.1-47.4.26',
      ],
      null,
    );

    const versions = await mod.getLoaderVersions('forge', '1.20.1');

    expect(versions.map((v) => v.version)).toEqual([
      '47.4.26',
      '47.4.25',
      '47.4.10',
      '47.4.5',
      '47.4.4',
      '47.0.0',
    ]);
    expect(defaultLoaderVersion(versions)).toBe('47.4.26');
  });

  it('still prefers the build Forge recommends to the newest one', async () => {
    serveForge(['1.20.1-47.4.5', '1.20.1-47.4.10', '1.20.1-47.4.26'], {
      '1.20.1-recommended': '47.4.10',
      '1.20.1-latest': '47.4.26',
    });

    const versions = await mod.getLoaderVersions('forge', '1.20.1');

    expect(versions.filter((v) => v.recommended).map((v) => v.version)).toEqual(['47.4.10']);
    expect(defaultLoaderVersion(versions)).toBe('47.4.10');
  });

  it.each([
    // What each service really sends for Minecraft 1.12.2.
    ['fabric', 400, '[]'],
    ['quilt', 404, '{"code":"not_found","message":"File with such name does not exist."}'],
  ] as const)(
    'reads the answer %s gives for a Minecraft version it has nothing for as no builds',
    async (loader, status, body) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(body, { status })),
      );

      expect(await mod.getLoaderVersions(loader, '1.12.2')).toEqual([]);
      expect(await mod.resolveDefaultLoaderVersion(loader, '1.12.2')).toBeUndefined();
    },
  );

  it('still reports a list that could not be fetched as a failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unavailable', { status: 503 })),
    );

    await expect(mod.getLoaderVersions('quilt', '1.21.4')).rejects.toThrow('Quilt API error: 503');
  });
});

describe('isLoaderInstalled', () => {
  const dir = () => path.join(root, 'loaders', 'fabric', '1.21.4-0.17.2');

  it('is false before anything is installed', async () => {
    expect(await mod.isLoaderInstalled('fabric', '0.17.2', '1.21.4')).toBe(false);
  });

  it('is true once the install has left a usable profile', async () => {
    serve({ inheritsFrom: '1.21.4', mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient' });

    await mod.installLoader('fabric', '0.17.2', '1.21.4');

    expect(await mod.isLoaderInstalled('fabric', '0.17.2', '1.21.4')).toBe(true);
    // Nothing half-written is left beside it.
    expect(await fs.readdir(dir())).toEqual(['fabric-profile.json']);
  });

  it('is false for a profile cut short, so the launch installs it again', async () => {
    // A file merely existing used to be enough, and a truncated one was then
    // never replaced: every launch found it "installed" and failed to read it.
    await fs.mkdir(dir(), { recursive: true });
    await fs.writeFile(path.join(dir(), 'fabric-profile.json'), '{"inheritsFrom":"1.21');

    expect(await mod.isLoaderInstalled('fabric', '0.17.2', '1.21.4')).toBe(false);
  });

  it('has nothing to install for vanilla', async () => {
    expect(await mod.isLoaderInstalled('vanilla', '', '1.21.4')).toBe(true);
  });
});
