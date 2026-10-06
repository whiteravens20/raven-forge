// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { useState, useCallback, useEffect } from 'react';
import { Search, Download, Package, RefreshCw, ArrowUpCircle } from 'lucide-react';
import { usePagedSearch } from '@hooks/use-paged-search';
import { InstalledEntryInfo, SearchPager, SearchResultRow } from '@components/SearchResults';
import { projectKey, useProjectDetails } from '@hooks/use-project-details';
import { useProfileStore } from '@stores/profile-store';
import { useGameStore } from '@stores/game-store';
import { Button } from '@components/ui/Button';
import { Input } from '@components/ui/Input';
import { Switch } from '@components/ui/Switch';
import { Banner } from '@components/ui/Banner';
import { EmptyState } from '@components/ui/EmptyState';
import { useT } from '@renderer/i18n';
import {
  SearchFilters,
  EMPTY_FILTERS,
  categoriesWithoutLoader,
  type SearchFilterState,
} from '@components/SearchFilters';
import { CompatibilityBadge } from '@components/CompatibilityBadge';
import { CompatibilityDialog } from '@components/CompatibilityDialog';
import { InstalledMark } from '@components/InstalledMark';
import { isClientModLoader } from '@shared/constants';
import { isProject } from '@shared/mod-identity';
import type {
  FacetGroups,
  InstallPlan,
  ModSearchResult,
  InstalledMod,
  ModUpdateSummary,
} from '@shared/ipc-types';

const api = window.ravenforge;

const NO_FACETS: FacetGroups = { loaders: [], groups: [], gameVersions: [] };

export function ModsPage() {
  const profiles = useProfileStore((s) => s.profiles);
  const selectedId = useProfileStore((s) => s.selectedProfileId);

  const t = useT();
  const [query, setQuery] = useState('');
  const search = usePagedSearch();
  const { results, searching, searched } = search;
  const [installed, setInstalled] = useState<InstalledMod[]>([]);
  const [tab, setTab] = useState<'installed' | 'browse'>('installed');
  const [error, setError] = useState<string | null>(null);
  const [facets, setFacets] = useState<FacetGroups>(NO_FACETS);
  const [filters, setFilters] = useState<SearchFilterState>(EMPTY_FILTERS);
  /**
   * The mods something is being done to right now, by id: installed, updated,
   * switched or removed.
   *
   * One set for all four. They were a single slot for installs and a second for
   * updates, so pressing Install on another mod took the spinner off the first
   * and left its button live — and a mod could be installed or updated twice at
   * once, each run deleting the file the other had just written.
   */
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const working = async (ids: string[], work: () => Promise<void>) => {
    setBusy((now) => new Set([...now, ...ids]));
    try {
      await work();
    } finally {
      setBusy((now) => new Set([...now].filter((id) => !ids.includes(id))));
    }
  };
  // The game has the mods folder open, and a launch being prepared is writing
  // into it. Nothing here changes it underneath either.
  const gameBusy = useGameStore((s) =>
    selectedId ? s.running.has(selectedId) || s.preparing.has(selectedId) : false,
  );
  /** Non-null while a compatibility warning is waiting on a decision. */
  const [plan, setPlan] = useState<{ mod: ModSearchResult; plan: InstallPlan } | null>(null);
  /** Something worth saying that is not a failure — dependencies that arrived. */
  const [note, setNote] = useState<string | null>(null);
  /** The last update check's counts, or null before one has run this session. */
  const [updateCheck, setUpdateCheck] = useState<ModUpdateSummary | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);

  const details = useProjectDetails(installed);
  const selectedProfile = profiles.find((p) => p.id === selectedId);
  const profileVersion = selectedProfile?.minecraftVersion;
  const profileLoader = selectedProfile?.modLoader;
  // What a browse row is matched against. Installed entries are keyed by
  // whatever named them: a project id when the launcher installed them, a slug
  // when a pack manifest did. A search result carries both, so both are asked —
  // checking the id alone leaves half a pack's mods offered a second time.
  // By any of the names an entry can go by — a pack's own id for a mod is not
  // the one the search speaks.
  const isInstalled = (mod: ModSearchResult) =>
    installed.some((entry) => isProject(entry, mod.id) || entry.id === mod.slug);

  // The badge is on the entry, put there by the last check, so this needs no
  // second source of truth and no request of its own.
  const outdated = installed.filter((mod) => mod.updateAvailable);
  // What the check would even look at. A profile whose mods all come from its
  // manifest has nothing to offer, and a button that always answers "0 of 0"
  // is a button that teaches people to ignore it.
  const checkable = installed.filter((mod) => !mod.fromManifest && mod.enabled);

  const loadInstalled = useCallback(async () => {
    if (!selectedId) return;
    const result = await api.mods.getInstalled(selectedId);
    if (result.success && result.data) setInstalled(result.data);
  }, [selectedId]);

  const handleSearch = () => {
    setError(null);
    void search.search({
      query: query.trim(),
      // Every constraint comes from the visible filter row. Reading the
      // version and loader straight off the profile is what made a search for
      // a mod that exists come back empty with nothing on screen to explain
      // it — Modrinth ANDs the facets, so "26.2 AND fabric" genuinely has no
      // Mekanism in it.
      gameVersion: filters.gameVersion || undefined,
      // Typed and separate from `categories`, even though Modrinth files
      // loaders under the same facet key — the profile's loader is a
      // constraint, not a tag the user picked.
      loader: isClientModLoader(filters.loader) ? filters.loader : undefined,
      categories: categoriesWithoutLoader(filters),
    });
  };

  /**
   * Check first, install second.
   *
   * The check is what stops a Forge jar landing in a Fabric profile, or a mod
   * arriving without the API it needs — neither of which fails loudly. It costs
   * one request when everything fits, which is the common case, and the plan it
   * returns names the exact build so installing cannot quietly pick another.
   */
  const handleInstall = async (mod: ModSearchResult) => {
    if (!selectedId || busy.has(mod.id)) return;
    setError(null);
    setNote(null);
    await working([mod.id], async () => {
      const check = await api.mods.checkInstall(selectedId, mod);
      if (!check.success || !check.data) {
        setError(check.error ?? t('mods.installFailed', { name: mod.name }));
        return;
      }
      // Nothing to decide when nothing is wrong — a dialog confirming that an
      // install is fine is a dialog people click through without reading.
      if (check.data.issues.length > 0) {
        setPlan({ mod, plan: check.data });
        return;
      }
      await install(mod, check.data.versionId);
    });
  };

  /** Download a build the profile has already agreed to. */
  const install = async (mod: ModSearchResult, versionId?: string) => {
    if (!selectedId) return;
    const result = await api.mods.installFromSearch(selectedId, mod, versionId);
    if (!result.success || !result.data) {
      setError(result.error ?? t('mods.installFailed', { name: mod.name }));
    } else if (result.data.dependencies.length > 0) {
      // Files appeared in the profile that nobody asked for. Say which.
      setNote(
        t('mods.installedWithDeps', {
          name: mod.name,
          deps: result.data.dependencies.join(', '),
        }),
      );
    }
    await loadInstalled();
  };

  /**
   * Ask Modrinth what has moved on.
   *
   * The answer is written into the lock file by the main process, so the badges
   * come from reloading the installed list rather than from anything held here
   * — which is also why they survive leaving the page and coming back.
   */
  const handleCheckUpdates = async () => {
    if (!selectedId) return;
    setError(null);
    setNote(null);
    setCheckingUpdates(true);
    try {
      const result = await api.mods.checkUpdates(selectedId);
      if (!result.success || !result.data) {
        setError(result.error ?? t('mods.checkUpdatesFailed'));
        return;
      }
      setUpdateCheck(result.data);
      await loadInstalled();
    } finally {
      setCheckingUpdates(false);
    }
  };

  const handleUpdate = async (wanted: string[]) => {
    // Not the ones already on their way: "Update all" pressed after one row's
    // "Update" used to send that mod a second time.
    const modIds = wanted.filter((id) => !busy.has(id));
    if (!selectedId || modIds.length === 0) return;
    setError(null);
    setNote(null);
    await working(modIds, async () => {
      const result = await api.mods.update(selectedId, modIds);
      if (!result.success || !result.data) {
        setError(result.error ?? t('mods.checkUpdatesFailed'));
        return;
      }
      // Both halves get said. A run that updated nine mods and lost one is not
      // a success and not a failure, and reporting only one of the two is how a
      // profile ends up with a mod nobody knows stayed behind.
      const { updated, failed } = result.data;
      if (updated.length > 0) setNote(t('mods.updated', { names: updated.join(', ') }));
      if (failed.length > 0) {
        setError(t('mods.updateFailed', { names: failed.map((f) => f.name).join(', ') }));
      }
      // The counts came from the check, and installing has just invalidated
      // them. The badges below come from the reloaded list, which is current.
      setUpdateCheck(null);
      await loadInstalled();
    });
  };

  // Both used to drop the answer. A switch that could not be flipped — the jar
  // deleted by hand, or held open by the game on Windows — simply did nothing,
  // and a mod that could not be removed left the list all the same.
  const handleToggle = async (mod: InstalledMod, enabled: boolean) => {
    if (!selectedId || busy.has(mod.id)) return;
    setError(null);
    await working([mod.id], async () => {
      const result = await api.mods.toggleEnabled(selectedId, mod.id, enabled);
      if (!result.success) {
        setError(result.error ?? t('mods.toggleFailed', { name: mod.name }));
      }
      await loadInstalled();
    });
  };

  const handleUninstall = async (mod: InstalledMod) => {
    if (!selectedId || busy.has(mod.id)) return;
    setError(null);
    await working([mod.id], async () => {
      const result = await api.mods.uninstall(selectedId, mod.id);
      if (!result.success) {
        setError(result.error ?? t('mods.removeFailed', { name: mod.name }));
      }
      await loadInstalled();
    });
  };

  useEffect(() => {
    void loadInstalled();
    // A summary line counts one profile's mods; carrying it to the next one
    // would describe a list that is no longer on screen.
    setUpdateCheck(null);
  }, [loadInstalled]);

  // Modrinth's own vocabulary, fetched rather than hardcoded — these lists move,
  // and a stale entry silently returns nothing for an option still on offer.
  useEffect(() => {
    let cancelled = false;
    void api.mods.getFacets('mod').then((r) => {
      if (cancelled) return;
      // A failed lookup costs the filters, not the search.
      setFacets(r.success && r.data ? r.data : NO_FACETS);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Start where the profile is — the right answer nine times out of ten — but
  // as a control that can be widened rather than a rule with no visible cause.
  useEffect(() => {
    setFilters((prev) => ({
      ...prev,
      gameVersion: profileVersion ?? '',
      loader: profileLoader && profileLoader !== 'vanilla' ? profileLoader : '',
    }));
  }, [profileVersion, profileLoader]);

  if (!selectedProfile) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-rf-text-muted">
        {t('mods.pickProfile')}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-display font-semibold text-rf-text">
          {t('mods.title', { profile: selectedProfile.name })}
        </h1>
        <div className="flex items-center gap-2">
          {tab === 'installed' && checkable.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={14} />}
              loading={checkingUpdates}
              onClick={() => void handleCheckUpdates()}
            >
              {t('mods.checkUpdates')}
            </Button>
          )}
          <div className="flex gap-1 rounded-lg border border-rf-border bg-rf-surface p-0.5">
            <button
              onClick={() => {
                setTab('installed');
                loadInstalled();
              }}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                tab === 'installed'
                  ? 'bg-rf-accent text-white'
                  : 'text-rf-text-secondary hover:text-rf-text'
              }`}
            >
              {t('mods.tabInstalled')}
            </button>
            <button
              onClick={() => setTab('browse')}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                tab === 'browse'
                  ? 'bg-rf-accent text-white'
                  : 'text-rf-text-secondary hover:text-rf-text'
              }`}
            >
              {t('mods.tabBrowse')}
            </button>
          </div>
        </div>
      </div>

      {tab === 'browse' && (
        <div className="space-y-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSearch();
            }}
            className="flex gap-2"
          >
            <div className="flex-1">
              <Input
                placeholder={t('mods.searchModrinth')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
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

          {search.error !== null && (
            <Banner type="urgent">{search.error || t('mods.searchFailed')}</Banner>
          )}
          {error && <Banner type="urgent">{error}</Banner>}
          {note && (
            <Banner type="info" dismissible onDismiss={() => setNote(null)}>
              {note}
            </Banner>
          )}
        </div>
      )}

      {plan && (
        <CompatibilityDialog
          plan={plan.plan}
          busy={busy.has(plan.mod.id)}
          onCancel={() => setPlan(null)}
          onInstall={() => {
            const pending = plan;
            setPlan(null);
            void working([pending.mod.id], () => install(pending.mod, pending.plan.versionId));
          }}
        />
      )}

      {tab === 'installed' ? (
        <div className="space-y-2">
          {error && <Banner type="urgent">{error}</Banner>}
          {note && (
            <Banner type="info" dismissible onDismiss={() => setNote(null)}>
              {note}
            </Banner>
          )}

          {/* Only after a check has run: before one, silence is the honest
              answer — nothing has been asked, so nothing is known. */}
          {updateCheck && (
            <div className="flex items-center gap-3 rounded-lg border border-rf-border bg-rf-surface px-3 py-2">
              <ArrowUpCircle
                size={16}
                className={outdated.length > 0 ? 'text-rf-accent-text' : 'text-rf-text-muted'}
                aria-hidden="true"
              />
              <p className="flex-1 text-xs text-rf-text-secondary">
                {updateCheck.updates > 0
                  ? t.plural('mods.updatesFound', updateCheck.updates)
                  : updateCheck.checked === 0
                    ? t('mods.noneToCheck')
                    : t('mods.upToDate')}
                {updateCheck.unknown > 0 &&
                  ` ${t.plural('mods.unknownToModrinth', updateCheck.unknown)}`}
              </p>
              {outdated.length > 1 && (
                <Button
                  size="sm"
                  loading={outdated.every((mod) => busy.has(mod.id))}
                  disabled={gameBusy}
                  onClick={() => void handleUpdate(outdated.map((mod) => mod.id))}
                >
                  {t('mods.updateAll')}
                </Button>
              )}
            </div>
          )}

          {installed.length === 0 ? (
            <EmptyState kind="mods" title={t('mods.empty')} hint={t('mods.emptyHint')} />
          ) : (
            installed.map((mod) => (
              <div
                key={mod.id}
                className="flex items-center gap-3 rounded-lg border border-rf-border bg-rf-surface p-3"
              >
                <InstalledEntryInfo
                  entry={mod}
                  details={details[projectKey(mod)]}
                  fallbackIcon={<Package size={18} className="shrink-0 text-rf-text-muted" />}
                >
                  {mod.version} • {t(`mods.source.${mod.source}`)}
                  {mod.fromManifest && ` • ${t('mods.fromManifest')}`}
                  {mod.updateAvailable && (
                    <span className="text-rf-accent-text">
                      {' • '}
                      {t('mods.updateTo', { version: mod.updateAvailable.versionNumber })}
                    </span>
                  )}
                </InstalledEntryInfo>
                <div className="flex items-center gap-2">
                  {mod.updateAvailable && (
                    <Button
                      size="sm"
                      icon={<ArrowUpCircle size={14} />}
                      loading={busy.has(mod.id)}
                      disabled={gameBusy}
                      onClick={() => void handleUpdate([mod.id])}
                    >
                      {t('mods.update')}
                    </Button>
                  )}
                  <Switch
                    checked={mod.enabled}
                    onChange={(next) => void handleToggle(mod, next)}
                    label={mod.name}
                    title={
                      gameBusy
                        ? t('mods.gameBusy')
                        : mod.enabled
                          ? t('common.disable')
                          : t('common.enable')
                    }
                    disabled={gameBusy || busy.has(mod.id)}
                  />
                  {!mod.fromManifest && (
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={gameBusy || busy.has(mod.id)}
                      onClick={() => void handleUninstall(mod)}
                    >
                      {t('common.remove')}
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {results.length === 0 && !searching && (
            <p className="py-8 text-center text-sm text-rf-text-muted">
              {!searched
                ? t('mods.searchHint')
                : filters.gameVersion
                  ? t('search.noResultsFiltered', { version: filters.gameVersion })
                  : t('search.noResults')}
            </p>
          )}
          {results.map((mod) => (
            <SearchResultRow
              key={mod.id}
              item={mod}
              action={
                isInstalled(mod) ? (
                  <InstalledMark />
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Download size={14} />}
                    loading={busy.has(mod.id)}
                    disabled={gameBusy}
                    title={gameBusy ? t('mods.gameBusy') : undefined}
                    onClick={() => void handleInstall(mod)}
                  >
                    {t('common.install')}
                  </Button>
                )
              }
            >
              {/* Judged against the profile, not against the filter row: the
                  filters can be widened to browse, and what matters is where
                  the mod is about to land. */}
              <CompatibilityBadge
                item={mod}
                gameVersion={profileVersion}
                modLoader={profileLoader}
              />
            </SearchResultRow>
          ))}
          <SearchPager
            shown={results.length}
            total={search.total}
            hasMore={search.hasMore}
            loading={search.loadingMore}
            onMore={() => void search.loadMore()}
          />
        </div>
      )}
    </div>
  );
}
