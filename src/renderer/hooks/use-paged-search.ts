// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { useCallback, useRef, useState } from 'react';
import { appendPage, hasMorePages, type PagedList } from '@shared/search-paging';
import type { ModSearchFilters, ModSearchResult } from '@shared/ipc-types';

const api = window.ravenforge;

/** One request's worth. Small enough to answer fast, large enough to fill a screen. */
const PAGE_SIZE = 20;

const EMPTY: PagedList<ModSearchResult> = { items: [], loaded: 0, total: 0 };

/** What a search was asked for — everything but which page of it. */
type SearchQuery = Omit<ModSearchFilters, 'offset' | 'limit'>;

/**
 * A Modrinth search that can go on past its first page.
 *
 * Every search in the launcher used to ask for twenty results and show twenty:
 * a query with four thousand matches and one with twenty looked the same, and
 * the twenty-first match could not be reached at all. This keeps the query that
 * produced the list, so the next page is the same question with a later offset.
 *
 * A reply is only used if it answers the search still on screen. Without that,
 * a slow first page landing after the player has already searched for something
 * else would put the old results under the new query.
 */
export function usePagedSearch() {
  const [list, setList] = useState<PagedList<ModSearchResult>>(EMPTY);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  /** Set once a search has come back, so "nothing matched" waits its turn. */
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The search on screen: what was asked, and how far into it the list has read. */
  const current = useRef<{ query: SearchQuery; list: PagedList<ModSearchResult> } | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);

  const search = useCallback(async (query: SearchQuery): Promise<void> => {
    const mine = ++generation.current;
    busy.current = true;
    setSearching(true);
    // A page of the previous search may still be on its way. Its reply is
    // dropped, and so is its "loading" — which it would otherwise never clear,
    // since it only tidies up after a search that is still the current one.
    setLoadingMore(false);
    setError(null);
    try {
      const reply = await api.mods.search({ ...query, offset: 0, limit: PAGE_SIZE });
      if (mine !== generation.current) return;
      if (reply.success && reply.data) {
        const first = appendPage(EMPTY, reply.data);
        current.current = { query, list: first };
        setList(first);
      } else {
        current.current = null;
        setList(EMPTY);
        setError(reply.error ?? '');
      }
      setSearched(true);
    } finally {
      if (mine === generation.current) {
        busy.current = false;
        setSearching(false);
      }
    }
  }, []);

  const loadMore = useCallback(async (): Promise<void> => {
    const state = current.current;
    // `busy` is a ref and not the state above: the scroll sentinel can ask twice
    // before React has rendered the first request's "loading".
    if (!state || busy.current || !hasMorePages(state.list)) return;

    const mine = generation.current;
    busy.current = true;
    setLoadingMore(true);
    try {
      const reply = await api.mods.search({
        ...state.query,
        offset: state.list.loaded,
        limit: PAGE_SIZE,
      });
      if (mine !== generation.current) return;
      if (!reply.success || !reply.data) {
        setError(reply.error ?? '');
        return;
      }
      state.list = appendPage(state.list, reply.data);
      setList(state.list);
    } finally {
      if (mine === generation.current) {
        busy.current = false;
        setLoadingMore(false);
      }
    }
  }, []);

  /** Forget the list — for when what is being searched changes underneath it. */
  const reset = useCallback(() => {
    generation.current++;
    busy.current = false;
    current.current = null;
    setList(EMPTY);
    setSearched(false);
    setSearching(false);
    setLoadingMore(false);
    setError(null);
  }, []);

  return {
    results: list.items,
    total: list.total,
    searching,
    loadingMore,
    searched,
    /** Empty string when the main process gave no reason; the page supplies its own. */
    error,
    hasMore: hasMorePages(list),
    search,
    loadMore,
    reset,
  };
}
