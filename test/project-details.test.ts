// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Descriptions for the mods a profile has.
 *
 * Asked of Modrinth by id or slug, and remembered — the list is opened far more
 * often than it changes. What matters here is what is sent (only names that
 * could be Modrinth's), how often (once, then from the file), and that a lookup
 * that fails costs the descriptions and nothing else.
 */

vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

const getProjects = vi.fn<(keys: string[]) => Promise<unknown[]>>();
vi.mock('../src/core/mods/modrinth-api', () => ({
  getProjects: (keys: string[]) => getProjects(keys),
}));

const sodium = {
  id: 'AANobbMI',
  slug: 'sodium',
  title: 'Sodium',
  description: 'A rendering engine replacement.',
  icon_url: 'https://cdn.modrinth.com/data/AANobbMI/icon.png',
};

let root: string;
type Details = typeof import('../src/core/mods/project-details');
let mod: Details;

async function load(): Promise<Details> {
  vi.resetModules();
  const { reloadDataRoot } = await import('../src/core/config/data-root');
  reloadDataRoot();
  return import('../src/core/mods/project-details');
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-project-details-'));
  process.env.RAVENFORGE_DATA_DIR = root;
  getProjects.mockReset();
  getProjects.mockResolvedValue([sodium]);
  mod = await load();
});

afterEach(async () => {
  vi.useRealTimers();
  delete process.env.RAVENFORGE_DATA_DIR;
  await fs.rm(root, { recursive: true, force: true });
});

describe('getProjectDetails', () => {
  it('answers under the name it was asked by, id or slug', async () => {
    // A pack manifest names a mod by slug; the launcher's own install by id.
    const found = await mod.getProjectDetails(['sodium', 'AANobbMI']);

    expect(found.sodium).toEqual({
      id: 'AANobbMI',
      slug: 'sodium',
      title: 'Sodium',
      description: 'A rendering engine replacement.',
      iconUrl: 'https://cdn.modrinth.com/data/AANobbMI/icon.png',
    });
    expect(found.AANobbMI).toEqual(found.sodium);
  });

  it('matches a slug without regard to case, and an id exactly', async () => {
    const found = await mod.getProjectDetails(['Sodium', 'aanobbmi']);

    expect(found.Sodium?.title).toBe('Sodium');
    // Ids are case-sensitive: this is some other project's name, or nobody's.
    expect(found.aanobbmi).toBeUndefined();
  });

  it('leaves out what Modrinth does not know', async () => {
    const found = await mod.getProjectDetails(['sodium', 'my-private-mod']);

    expect(Object.keys(found)).toEqual(['sodium']);
  });

  it('sends only names that could be a project, never a path or a file hash', async () => {
    await mod.getProjectDetails([
      'sodium',
      'mods/secret-build.jar',
      '../../etc/passwd',
      'z'.repeat(32),
      '0123456789abcdef0123456789abcdef',
      '',
    ]);

    expect(getProjects).toHaveBeenCalledTimes(1);
    // The 32-character one that is not hexadecimal is a legal slug; the one
    // that is hexadecimal is the stand-in id of a file from outside Modrinth.
    expect(getProjects.mock.calls[0][0]).toEqual(['sodium', 'z'.repeat(32)]);
  });

  it('asks once, and answers from memory after that', async () => {
    await mod.getProjectDetails(['sodium']);
    const again = await mod.getProjectDetails(['sodium']);

    expect(getProjects).toHaveBeenCalledTimes(1);
    expect(again.sodium?.title).toBe('Sodium');
  });

  it('remembers across a restart', async () => {
    await mod.getProjectDetails(['sodium']);

    mod = await load();
    getProjects.mockClear();
    const found = await mod.getProjectDetails(['sodium']);

    expect(getProjects).not.toHaveBeenCalled();
    expect(found.sodium?.description).toBe('A rendering engine replacement.');
  });

  it('remembers that a name is unknown, so it is not asked about on every visit', async () => {
    await mod.getProjectDetails(['my-private-mod']);
    await mod.getProjectDetails(['my-private-mod']);

    expect(getProjects).toHaveBeenCalledTimes(1);
  });

  it('asks again about an unknown name a day later, since projects do get published', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-01T12:00:00Z') });
    await mod.getProjectDetails(['my-private-mod']);

    vi.setSystemTime(new Date('2026-10-02T13:00:00Z'));
    await mod.getProjectDetails(['my-private-mod']);

    expect(getProjects).toHaveBeenCalledTimes(2);
  });

  it('keeps what it has when Modrinth cannot be reached', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-01T12:00:00Z') });
    await mod.getProjectDetails(['sodium']);

    // Stale by now, so it is asked about again — and the question fails.
    vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
    getProjects.mockRejectedValue(new Error('fetch failed'));
    const found = await mod.getProjectDetails(['sodium', 'lithium']);

    expect(found.sodium?.title).toBe('Sodium');
    expect(found.lithium).toBeUndefined();
  });
});
