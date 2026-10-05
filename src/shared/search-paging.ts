// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

/**
 * A result list that arrives a page at a time.
 *
 * `loaded` is how far into the index the list has read, which is not the same
 * as how many rows it holds — see {@link appendPage}.
 */
export interface PagedList<T> {
  items: T[];
  loaded: number;
  total: number;
}

/**
 * Add the next page to a list.
 *
 * Two things here are easy to get wrong and invisible when they are.
 *
 * The offset for the page after this one advances by what was *asked for and
 * returned*, not by what was kept. The index moves while someone pages through
 * it — a project gains downloads and slides from page two onto page three — so
 * a page can repeat an entry already on screen. Dropping the repeat is right;
 * counting the offset from the shortened list would then ask for a page that
 * overlaps the last one, every time, and the list would never reach its end.
 *
 * And an empty page ends the list whatever the total claimed a moment ago:
 * otherwise a total that was an overcount leaves a "load more" that loads
 * nothing for ever.
 */
export function appendPage<T extends { id: string }>(
  list: PagedList<T>,
  page: { hits: T[]; total: number },
): PagedList<T> {
  const seen = new Set(list.items.map((item) => item.id));
  const loaded = list.loaded + page.hits.length;
  return {
    items: [...list.items, ...page.hits.filter((hit) => !seen.has(hit.id))],
    loaded,
    total: page.hits.length === 0 ? loaded : page.total,
  };
}

/** Whether asking for another page could bring anything. */
export function hasMorePages(list: PagedList<unknown>): boolean {
  return list.items.length > 0 && list.loaded < list.total;
}
