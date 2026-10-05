// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect } from 'vitest';
import { appendPage, hasMorePages, type PagedList } from '../src/shared/search-paging';

/**
 * Paging through a search index that does not hold still.
 *
 * Every search used to show its first twenty results and stop, whether there
 * were twenty matches or four thousand. Going past the first page brings two
 * ways to be wrong without anything looking wrong, and these pin both.
 */

const hit = (id: string) => ({ id });
const empty: PagedList<{ id: string }> = { items: [], loaded: 0, total: 0 };

describe('appendPage', () => {
  it('starts a list from its first page', () => {
    const list = appendPage(empty, { hits: [hit('a'), hit('b')], total: 5 });

    expect(list.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(list.loaded).toBe(2);
    expect(list.total).toBe(5);
    expect(hasMorePages(list)).toBe(true);
  });

  it('adds the next page after what is already there', () => {
    const first = appendPage(empty, { hits: [hit('a'), hit('b')], total: 4 });
    const second = appendPage(first, { hits: [hit('c'), hit('d')], total: 4 });

    expect(second.items.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(hasMorePages(second)).toBe(false);
  });

  it('shows an entry once when the index shifted it onto the next page', () => {
    // `b` gained downloads between the two requests and is served again.
    const first = appendPage(empty, { hits: [hit('a'), hit('b')], total: 5 });
    const second = appendPage(first, { hits: [hit('b'), hit('c')], total: 5 });

    expect(second.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('still moves the offset on by a whole page when a repeat was dropped', () => {
    // Counting the offset from the three rows kept would ask for the page
    // starting at 3 next, overlapping this one again — and so on for ever.
    const first = appendPage(empty, { hits: [hit('a'), hit('b')], total: 5 });
    const second = appendPage(first, { hits: [hit('b'), hit('c')], total: 5 });

    expect(second.loaded).toBe(4);
  });

  it('ends on an empty page, whatever the total said', () => {
    // A total that was an overcount must not leave a button that loads nothing.
    const first = appendPage(empty, { hits: [hit('a'), hit('b')], total: 40 });
    const second = appendPage(first, { hits: [], total: 40 });

    expect(hasMorePages(second)).toBe(false);
    expect(second.total).toBe(2);
  });

  it('follows the total as it moves', () => {
    const first = appendPage(empty, { hits: [hit('a')], total: 3 });
    const second = appendPage(first, { hits: [hit('b')], total: 7 });

    expect(second.total).toBe(7);
  });
});

describe('hasMorePages', () => {
  it('has nothing more to offer for a search that matched nothing', () => {
    expect(hasMorePages(appendPage(empty, { hits: [], total: 0 }))).toBe(false);
  });

  it('has nothing more once everything is loaded', () => {
    expect(hasMorePages(appendPage(empty, { hits: [hit('a')], total: 1 }))).toBe(false);
  });
});
