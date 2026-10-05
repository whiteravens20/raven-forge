// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { searchMods } from '../src/core/mods/modrinth-api';

/**
 * What a search asks Modrinth for, and what it hands back.
 *
 * The request is built from a filter row, and Modrinth ANDs facet groups — so a
 * group that should not be there turns a correct search into an empty one, with
 * nothing on screen to say why.
 */

let requested: URL;

function serve(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requested = new URL(url);
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
}

const hitFor = (id: string) => ({
  project_id: id,
  slug: `slug-${id}`,
  title: `Title ${id}`,
  description: 'What it does',
  author: 'someone',
  icon_url: null,
  downloads: 12,
  versions: ['1.21.1'],
  categories: ['fabric'],
  project_type: 'mod',
});

const facets = () => JSON.parse(requested.searchParams.get('facets') ?? '[]') as string[][];

beforeEach(() => {
  serve({ hits: [hitFor('a'), hitFor('b')], offset: 0, limit: 20, total_hits: 4321 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('searchMods', () => {
  it('returns the total alongside the page, so a second page can be asked for', async () => {
    const page = await searchMods({ query: 'sodium' });

    expect(page.total).toBe(4321);
    expect(page.hits.map((h) => h.id)).toEqual(['a', 'b']);
    expect(page.hits[0]).toMatchObject({ slug: 'slug-a', name: 'Title a', iconUrl: undefined });
  });

  it('asks for the page it was given', async () => {
    await searchMods({ query: '', offset: 40, limit: 20 });

    expect(requested.searchParams.get('offset')).toBe('40');
    expect(requested.searchParams.get('limit')).toBe('20');
  });

  it('never asks for more than Modrinth will serve in one page', async () => {
    await searchMods({ query: '', limit: 5000, offset: -3 });

    expect(requested.searchParams.get('limit')).toBe('100');
    expect(requested.searchParams.get('offset')).toBe('0');
  });

  it('narrows a mod search by loader and version, each as its own group', async () => {
    await searchMods({ query: 'x', loader: 'neoforge', gameVersion: '1.21.1' });

    expect(facets()).toEqual([['project_type:mod'], ['versions:1.21.1'], ['categories:neoforge']]);
  });

  it('narrows a modpack search by loader too', async () => {
    await searchMods({ query: '', projectType: 'modpack', loader: 'fabric' });

    expect(facets()).toEqual([['project_type:modpack'], ['categories:fabric']]);
  });

  it('leaves the loader out for shaders, where it would match nothing', async () => {
    // A shader is filed under the shader loader that runs it, not under Fabric.
    await searchMods({ query: '', projectType: 'shader', loader: 'fabric' });

    expect(facets()).toEqual([['project_type:shader']]);
  });
});
