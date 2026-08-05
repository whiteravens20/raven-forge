import { useState, useCallback, useEffect } from 'react';
import { Search, Download, Package } from 'lucide-react';
import { useProfileStore } from '@stores/profile-store';
import { Button } from '@components/ui/Button';
import { Input } from '@components/ui/Input';
import { Banner } from '@components/ui/Banner';
import { EmptyState } from '@components/ui/EmptyState';
import { useLocale, useT } from '@renderer/i18n';
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
import type { FacetGroups, InstallPlan, ModSearchResult, InstalledMod } from '@shared/ipc-types';

const api = window.ravenforge;

const NO_FACETS: FacetGroups = { loaders: [], groups: [], gameVersions: [] };

export function ModsPage() {
  const profiles = useProfileStore((s) => s.profiles);
  const selectedId = useProfileStore((s) => s.selectedProfileId);

  const t = useT();
  const locale = useLocale();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ModSearchResult[]>([]);
  const [installed, setInstalled] = useState<InstalledMod[]>([]);
  const [searching, setSearching] = useState(false);
  const [tab, setTab] = useState<'installed' | 'browse'>('installed');
  const [error, setError] = useState<string | null>(null);
  const [facets, setFacets] = useState<FacetGroups>(NO_FACETS);
  const [filters, setFilters] = useState<SearchFilterState>(EMPTY_FILTERS);
  /** Set once a search has run, so the "nothing matched" line waits its turn. */
  const [searched, setSearched] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Non-null while a compatibility warning is waiting on a decision. */
  const [plan, setPlan] = useState<{ mod: ModSearchResult; plan: InstallPlan } | null>(null);
  /** Something worth saying that is not a failure — dependencies that arrived. */
  const [note, setNote] = useState<string | null>(null);

  const selectedProfile = profiles.find((p) => p.id === selectedId);
  const profileVersion = selectedProfile?.minecraftVersion;
  const profileLoader = selectedProfile?.modLoader;
  // What a browse row is matched against. Installed entries are keyed by
  // whatever named them: a project id when the launcher installed them, a slug
  // when a pack manifest did. A search result carries both, so both are asked —
  // checking the id alone leaves half a pack's mods offered a second time.
  const installedIds = new Set(installed.map((mod) => mod.id));
  const isInstalled = (mod: ModSearchResult) =>
    installedIds.has(mod.id) || installedIds.has(mod.slug);

  const loadInstalled = useCallback(async () => {
    if (!selectedId) return;
    const result = await api.mods.getInstalled(selectedId);
    if (result.success && result.data) setInstalled(result.data);
  }, [selectedId]);

  const handleSearch = async () => {
    setSearching(true);
    setError(null);
    try {
      const result = await api.mods.search({
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
        limit: 20,
      });
      if (result.success && result.data) setResults(result.data);
      else setError(result.error ?? t('mods.searchFailed'));
      setSearched(true);
    } finally {
      setSearching(false);
    }
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
    if (!selectedId) return;
    setError(null);
    setNote(null);
    setBusyId(mod.id);
    try {
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
    } finally {
      setBusyId(null);
    }
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

  const handleToggle = async (modId: string, enabled: boolean) => {
    if (!selectedId) return;
    await api.mods.toggleEnabled(selectedId, modId, !enabled);
    await loadInstalled();
  };

  const handleUninstall = async (modId: string) => {
    if (!selectedId) return;
    await api.mods.uninstall(selectedId, modId);
    await loadInstalled();
  };

  useEffect(() => {
    void loadInstalled();
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
          busy={busyId === plan.mod.id}
          onCancel={() => setPlan(null)}
          onInstall={() => {
            const pending = plan;
            setPlan(null);
            setBusyId(pending.mod.id);
            void install(pending.mod, pending.plan.versionId).finally(() => setBusyId(null));
          }}
        />
      )}

      {tab === 'installed' ? (
        <div className="space-y-2">
          {installed.length === 0 ? (
            <EmptyState kind="mods" title={t('mods.empty')} hint={t('mods.emptyHint')} />
          ) : (
            installed.map((mod) => (
              <div
                key={mod.id}
                className="flex items-center gap-3 rounded-lg border border-rf-border bg-rf-surface p-3"
              >
                <Package size={18} className="shrink-0 text-rf-text-muted" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-rf-text truncate">{mod.name}</p>
                  <p className="text-xs text-rf-text-muted">
                    {mod.version} • {mod.source}
                    {mod.fromManifest && ` • ${t('mods.fromManifest')}`}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleToggle(mod.id, mod.enabled)}
                  >
                    {mod.enabled ? t('common.disable') : t('common.enable')}
                  </Button>
                  {!mod.fromManifest && (
                    <Button variant="danger" size="sm" onClick={() => handleUninstall(mod.id)}>
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
            <div
              key={mod.id}
              className="flex items-center gap-3 rounded-lg border border-rf-border bg-rf-surface p-3"
            >
              {mod.iconUrl ? (
                <img src={mod.iconUrl} alt="" className="h-10 w-10 rounded shrink-0" />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded bg-rf-bg-tertiary shrink-0">
                  <Package size={18} className="text-rf-text-muted" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-rf-text">{mod.name}</p>
                <p className="text-xs text-rf-text-muted truncate">{mod.description}</p>
                <p className="text-xs text-rf-text-muted">
                  {mod.author} •{' '}
                  {t.plural('mods.downloads', mod.downloads, {
                    count: mod.downloads.toLocaleString(locale),
                  })}
                </p>
                {/* Judged against the profile, not against the filter row: the
                    filters can be widened to browse, and what matters is where
                    the mod is about to land. */}
                <CompatibilityBadge
                  item={mod}
                  gameVersion={profileVersion}
                  modLoader={profileLoader}
                />
              </div>
              {isInstalled(mod) ? (
                <InstalledMark />
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Download size={14} />}
                  loading={busyId === mod.id}
                  onClick={() => void handleInstall(mod)}
                >
                  {t('common.install')}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
