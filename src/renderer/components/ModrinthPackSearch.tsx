// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { useEffect, useRef, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { Button } from '@components/ui/Button';
import { Input } from '@components/ui/Input';
import { Banner } from '@components/ui/Banner';
import {
  SearchFilters,
  EMPTY_FILTERS,
  categoriesWithoutLoader,
  type SearchFilterState,
} from '@components/SearchFilters';
import { SearchPager, SearchResultRow } from '@components/SearchResults';
import { usePagedSearch } from '@hooks/use-paged-search';
import { useT } from '@renderer/i18n';
import { isClientModLoader } from '@shared/constants';
import type { FacetGroups, ModSearchResult, PackInstall } from '@shared/ipc-types';

const api = window.ravenforge;

const NO_FACETS: FacetGroups = { loaders: [], groups: [], gameVersions: [] };

/**
 * Find a modpack on Modrinth and install it as a new profile.
 *
 * The same search as the mods page — the same field, filter row, result rows
 * and paging, on the same components — pointed at a different project type.
 * The one difference is what Install means: here it makes a profile, where
 * there it adds a file to one.
 */
export function ModrinthPackSearch({
  onBusy,
  onInstalled,
}: {
  /** Told while an install runs, so the dialog can hold itself open. */
  onBusy: (busy: boolean) => void;
  /** A profile was made — whether or not all of the pack's files arrived. */
  onInstalled: (install: PackInstall) => void;
}) {
  const t = useT();
  const search = usePagedSearch();
  const { results, searching, searched } = search;
  const [query, setQuery] = useState('');
  const [facets, setFacets] = useState<FacetGroups>(NO_FACETS);
  const [filters, setFilters] = useState<SearchFilterState>(EMPTY_FILTERS);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runSearch = () => {
    setError(null);
    void search.search({
      query: query.trim(),
      projectType: 'modpack',
      gameVersion: filters.gameVersion || undefined,
      loader: isClientModLoader(filters.loader) ? filters.loader : undefined,
      categories: categoriesWithoutLoader(filters),
    });
  };

  // The most downloaded packs straight away: with no query Modrinth orders by
  // popularity, so there is a list to pick from before anything is typed. Once,
  // on arrival — the ref is what keeps a re-render from asking again.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    runSearch();
  });

  useEffect(() => {
    let cancelled = false;
    void api.mods.getFacets('modpack').then((r) => {
      if (cancelled) return;
      // A failed lookup costs the filters, not the search.
      setFacets(r.success && r.data ? r.data : NO_FACETS);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const install = async (pack: ModSearchResult) => {
    setBusyId(pack.id);
    setError(null);
    onBusy(true);
    try {
      // The filter row decides which version of the pack arrives: a pack
      // publishes one per Minecraft version and loader, and the row is where
      // the player has already said which they are after.
      const result = await api.packs.installModrinth(pack, {
        gameVersion: filters.gameVersion || undefined,
        loader: isClientModLoader(filters.loader) ? filters.loader : undefined,
      });
      if (result.success && result.data) onInstalled(result.data);
      else setError(result.error ?? t('packs.installFailed', { name: pack.name }));
    } finally {
      setBusyId(null);
      onBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          runSearch();
        }}
        className="flex gap-2"
      >
        <div className="flex-1">
          <Input
            placeholder={t('packs.searchModrinth')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>
        <Button type="submit" icon={<Search size={14} />} loading={searching}>
          {t('common.search')}
        </Button>
      </form>

      <SearchFilters
        facets={facets}
        value={filters}
        onChange={setFilters}
        loaderLabel={t('mods.loaderFilter')}
      />
      <p className="text-xs text-rf-text-muted">{t('packs.modrinthNote')}</p>

      {search.error !== null && (
        <Banner type="urgent">{search.error || t('mods.searchFailed')}</Banner>
      )}
      {error && <Banner type="urgent">{error}</Banner>}

      {results.length === 0 && !searching && searched && (
        <p className="py-8 text-center text-sm text-rf-text-muted">
          {filters.gameVersion
            ? t('search.noResultsFiltered', { version: filters.gameVersion })
            : t('search.noResults')}
        </p>
      )}

      {results.map((pack) => (
        <SearchResultRow
          key={pack.id}
          item={pack}
          action={
            <Button
              variant="primary"
              size="sm"
              icon={<Download size={14} />}
              loading={busyId === pack.id}
              disabled={busyId !== null}
              onClick={() => void install(pack)}
            >
              {t('common.install')}
            </Button>
          }
        />
      ))}
      <SearchPager
        shown={results.length}
        total={search.total}
        hasMore={search.hasMore}
        loading={search.loadingMore}
        onMore={() => void search.loadMore()}
      />
    </div>
  );
}
