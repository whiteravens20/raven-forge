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
