import { useState, useCallback, useEffect } from 'react';
import { Search, Download, Sparkles, Image, ChevronUp, ChevronDown } from 'lucide-react';
import { useProfileStore } from '@stores/profile-store';
import { Button } from '@components/ui/Button';
import { Input } from '@components/ui/Input';
import { Banner } from '@components/ui/Banner';
import { EmptyState } from '@components/ui/EmptyState';
import { useLocale, useT } from '@renderer/i18n';
import { loaderLabel } from '@shared/labels';
import {
  SearchFilters,
  EMPTY_FILTERS,
  filterCategories,
  type SearchFilterState,
} from '@components/SearchFilters';
import { ShaderLoaderPicker } from '@components/ShaderLoaderPicker';
import { CompatibilityBadge } from '@components/CompatibilityBadge';
import { CompatibilityDialog } from '@components/CompatibilityDialog';
import { InstalledMark } from '@components/InstalledMark';
import type {
  FacetGroups,
  InstallPlan,
  ModSearchResult,
  InstalledMod,
  ShaderLoaderOption,
  ShaderLoaderResult,
  ShaderLoaderState,
} from '@shared/ipc-types';

const api = window.ravenforge;

const NO_FACETS: FacetGroups = { loaders: [], groups: [], gameVersions: [] };

type Kind = 'shaders' | 'resourcepacks';

/**
 * Shaders and resource packs.
 *
 * They are deliberately not folded into the mods page. Resource packs are
 * *ordered* — the game applies them top-down and a pack only overrides what the
 * ones below it did not — which is a concept mods do not have and a control the
 * mods list has nowhere to put. Keeping them apart also keeps a 200-entry mod
 * list from burying the two shader packs someone actually swaps between.
 */
export function ContentPage() {
  const profiles = useProfileStore((s) => s.profiles);
  const selectedId = useProfileStore((s) => s.selectedProfileId);

  const t = useT();
  const locale = useLocale();
  const [kind, setKind] = useState<Kind>('shaders');
  const [tab, setTab] = useState<'installed' | 'browse'>('installed');
  const [installed, setInstalled] = useState<InstalledMod[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ModSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [facets, setFacets] = useState<FacetGroups>(NO_FACETS);
  const [filters, setFilters] = useState<SearchFilterState>(EMPTY_FILTERS);
  /** Outcome of the last shader-loader check or install, shown as one banner. */
  const [loaderNote, setLoaderNote] = useState<ShaderLoaderState | ShaderLoaderResult | null>(null);
  /** Non-null while the "which shader loader?" dialog is open. */
  const [choosingLoader, setChoosingLoader] = useState<ShaderLoaderOption[] | null>(null);
  const [installingLoader, setInstallingLoader] = useState(false);
  /** Non-null while a compatibility warning is waiting on a decision. */
  const [plan, setPlan] = useState<{ item: ModSearchResult; plan: InstallPlan } | null>(null);

  const selectedProfile = profiles.find((p) => p.id === selectedId);
  const profileVersion = selectedProfile?.minecraftVersion;
  // What a browse row is matched against. Installed entries are keyed by
  // whatever named them: a project id when the launcher installed them, a slug
  // when a pack manifest did — and a search result carries both. Switching kind
  // reloads the list, so shaders are never matched against resource packs.
  const installedIds = new Set(installed.map((item) => item.id));
  const isInstalled = (item: ModSearchResult) =>
    installedIds.has(item.id) || installedIds.has(item.slug);

  const loadInstalled = useCallback(async () => {
    if (!selectedId) return;
    const result =
      kind === 'shaders'
        ? await api.content.getShaders(selectedId)
        : await api.content.getResourcePacks(selectedId);
    if (result.success && result.data) setInstalled(result.data);
    else setInstalled([]);
  }, [selectedId, kind]);

  useEffect(() => {
    void loadInstalled();
  }, [loadInstalled]);

  // Switching kind must not leave the previous kind's results or filters on
  // screen — neither carries over. A shader loader means nothing for a resource
  // pack, and `32x` returns nothing for a shader.
  useEffect(() => {
    setResults([]);
    setError(null);
    // The version pin survives a kind switch — it is a property of the profile
    // you are dressing up, not of what you are dressing it in. The rest does
    // not: a shader loader means nothing for a resource pack, and `32x` returns
    // nothing for a shader.
    setFilters((prev) => ({ ...EMPTY_FILTERS, gameVersion: prev.gameVersion }));

    let cancelled = false;
    void api.mods.getFacets(kind === 'shaders' ? 'shader' : 'resourcepack').then((r) => {
      if (cancelled) return;
      // A failed lookup costs the filters, not the search — leave them empty
      // rather than blocking the page on Modrinth being reachable.
      setFacets(r.success && r.data ? r.data : NO_FACETS);
    });
    return () => {
      cancelled = true;
    };
  }, [kind]);

  // Start pinned to the profile, which is the answer nine times out of ten —
  // but as a visible, changeable control rather than an invisible rule.
  useEffect(() => {
    setFilters((prev) => ({ ...prev, gameVersion: profileVersion ?? '' }));
  }, [profileVersion]);

  const handleSearch = async () => {
    // No early return on an empty query: Modrinth searches happily without one,
    // and "every 32x vanilla-like pack for my version" is a question worth
    // being able to ask without inventing a word to type.
    setSearching(true);
    setError(null);
    try {
      const result = await api.mods.search({
        query: query.trim(),
        projectType: kind === 'shaders' ? 'shader' : 'resourcepack',
        // One value per axis, each its own facet group. Modrinth ORs within a
        // group and ANDs across them, so this reads as "iris AND realistic AND
        // potato" — narrowing, which is what a filter row is expected to do.
        categories: filterCategories(filters),
        gameVersion: filters.gameVersion || undefined,
        limit: 20,
      });
      if (result.success && result.data) setResults(result.data);
      else setError(result.error ?? t('content.searchFailed'));
    } finally {
      setSearching(false);
    }
  };

  /**
   * Check the pack fits this profile's Minecraft version, then install it.
   *
   * The check is worth the round trip because neither failure is visible: a
   * shader built for another version fails to compile inside Iris, and a
   * resource pack lands in the game's "incompatible" list. From here both look
   * exactly like a successful install.
   */
  const handleInstall = async (item: ModSearchResult) => {
    if (!selectedId) return;
    setBusyId(item.id);
    setError(null);
    setLoaderNote(null);
    try {
      const check = await api.content.checkInstall(selectedId, item);
      if (!check.success || !check.data) {
        setError(check.error ?? t('content.installFailed', { name: item.name }));
        return;
      }
      if (check.data.issues.length > 0) {
        setPlan({ item, plan: check.data });
        return;
      }
      await install(item, check.data.versionId);
    } finally {
      setBusyId(null);
    }
  };

  const install = async (item: ModSearchResult, versionId?: string) => {
    if (!selectedId) return;
    const source = `modrinth:${item.id}`;
    const result =
      kind === 'shaders'
        ? await api.content.installShader(selectedId, source, versionId)
        : await api.content.installResourcePack(selectedId, source, versionId);
    if (!result.success) {
      setError(result.error ?? t('content.installFailed', { name: item.name }));
      return;
    }
    await loadInstalled();

    // Only after the pack is on disk. Asking first would be asking about
    // something that might yet fail to download.
    if (kind === 'shaders') await checkShaderLoader(selectedId);
  };

  /**
   * Does this profile have something that can *read* a shader pack?
   *
   * A pack with no loader behind it is a zip in a folder nothing opens, and the
   * install looks identical either way — so this runs once the pack lands and
   * either offers the choice or explains why there is none.
   */
  const checkShaderLoader = async (profileId: string) => {
    const state = await api.content.getShaderLoaderState(profileId);
    if (!state.success || !state.data) return;
    if (state.data.status === 'choose') setChoosingLoader(state.data.options);
    // `already-installed` says nothing: it is the expected case, and a banner
    // confirming that nothing happened is a banner people learn to ignore.
    else if (state.data.status !== 'already-installed') setLoaderNote(state.data);
  };

  const handleInstallLoader = async (projectId: string) => {
    if (!selectedId) return;
    setInstallingLoader(true);
    try {
      const result = await api.content.installShaderLoader(selectedId, projectId);
      if (result.success && result.data) setLoaderNote(result.data);
      else setError(result.error ?? t('content.loaderFailed', { error: '' }));
      setChoosingLoader(null);
    } finally {
      setInstallingLoader(false);
    }
  };

  const handleRemove = async (id: string) => {
    if (!selectedId) return;
    setBusyId(id);
    try {
      const result =
        kind === 'shaders'
          ? await api.content.removeShader(selectedId, id)
          : await api.content.removeResourcePack(selectedId, id);
      if (!result.success) setError(result.error ?? t('content.removeFailed'));
      await loadInstalled();
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Move a resource pack one place in the load order.
   *
   * Buttons rather than drag-and-drop: the list is short, and a keyboard user
   * gets the same control for free instead of none at all.
   */
  const handleMove = async (index: number, delta: number) => {
    if (!selectedId) return;
    const next = [...installed];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];

    // Optimistic: the reorder is a local file rewrite and the list is the only
    // thing that changed. Reverting on failure beats a visible lag on every click.
    setInstalled(next);
    const result = await api.content.reorderResourcePacks(
      selectedId,
      next.map((p) => p.id),
    );
    if (!result.success) {
      setError(result.error ?? t('content.reorderFailed'));
      await loadInstalled();
    }
  };

  if (!selectedProfile) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-rf-text-muted">
        {t('content.pickProfile')}
      </div>
    );
  }

  const Icon = kind === 'shaders' ? Sparkles : Image;

  return (
    <div className="flex h-full flex-col gap-4 p-6 overflow-y-auto">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-display font-semibold text-rf-text">
          {t('content.title', { profile: selectedProfile.name })}
        </h1>
        <div className="flex gap-1 rounded-lg border border-rf-border bg-rf-surface p-0.5">
          {(['installed', 'browse'] as const).map((value) => (
            <button
              key={value}
              onClick={() => {
                setTab(value);
                if (value === 'installed') void loadInstalled();
              }}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                tab === value
                  ? 'bg-rf-accent text-white'
                  : 'text-rf-text-secondary hover:text-rf-text'
              }`}
            >
              {value === 'installed' ? t('content.tabInstalled') : t('content.tabBrowse')}
            </button>
          ))}
        </div>
      </div>

      <div
        className="flex gap-1 self-start rounded-lg border border-rf-border bg-rf-surface p-0.5"
        role="tablist"
        aria-label={t('content.kindLabel')}
      >
        {(['shaders', 'resourcepacks'] as const).map((value) => (
          <button
            key={value}
            role="tab"
            aria-selected={kind === value}
            onClick={() => setKind(value)}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
              kind === value
                ? 'bg-rf-accent text-white'
                : 'text-rf-text-secondary hover:text-rf-text'
            }`}
          >
            {value === 'shaders' ? t('content.shaders') : t('content.resourcePacks')}
          </button>
        ))}
      </div>

      {error && <Banner type="urgent">{error}</Banner>}
      {loaderNote && <LoaderNote note={loaderNote} onDismiss={() => setLoaderNote(null)} />}

      {choosingLoader && (
        <ShaderLoaderPicker
          options={choosingLoader}
          busy={installingLoader}
          onInstall={(projectId) => void handleInstallLoader(projectId)}
          onSkip={() => setChoosingLoader(null)}
        />
      )}

      {plan && (
        <CompatibilityDialog
          plan={plan.plan}
          busy={busyId === plan.item.id}
          onCancel={() => setPlan(null)}
          onInstall={() => {
            const pending = plan;
            setPlan(null);
            setBusyId(pending.item.id);
            void install(pending.item, pending.plan.versionId).finally(() => setBusyId(null));
          }}
        />
      )}

      {tab === 'browse' ? (
        <div className="space-y-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSearch();
            }}
            className="flex gap-2"
          >
            <div className="flex-1">
              <Input
                placeholder={
                  kind === 'shaders' ? t('content.searchShaders') : t('content.searchPacks')
                }
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Button type="submit" icon={<Search size={14} />} loading={searching}>
              {t('common.search')}
            </Button>
          </form>

          {/* Only shaders have a meaningful loader choice — Modrinth reports
              resource packs as loader "minecraft", one option filtering nothing. */}
          <SearchFilters
            facets={facets}
            value={filters}
            onChange={setFilters}
            loaderLabel={t('content.loaderFilter')}
            showLoader={kind === 'shaders'}
          />

          {kind === 'shaders' && <Banner type="info">{t('content.shadersNeedIris')}</Banner>}

          {results.length === 0 && !searching && (
            <p className="py-8 text-center text-sm text-rf-text-muted">{t('content.browseHint')}</p>
          )}

          {results.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 rounded-lg border border-rf-border bg-rf-surface p-3"
            >
              {item.iconUrl ? (
                <img src={item.iconUrl} alt="" className="h-10 w-10 rounded shrink-0" />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded bg-rf-bg-tertiary shrink-0">
                  <Icon size={18} className="text-rf-text-muted" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-rf-text">{item.name}</p>
                <p className="text-xs text-rf-text-muted truncate">{item.description}</p>
                <p className="text-xs text-rf-text-muted">
                  {item.author} •{' '}
                  {t.plural('mods.downloads', item.downloads, {
                    count: item.downloads.toLocaleString(locale),
                  })}
                </p>
                {/* No loader: a resource pack has none, and a shader's loader is
                    Iris or OptiFine, which the shader loader picker handles. */}
                <CompatibilityBadge item={item} gameVersion={profileVersion} />
              </div>
              {isInstalled(item) ? (
                <InstalledMark />
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Download size={14} />}
                  loading={busyId === item.id}
                  onClick={() => void handleInstall(item)}
                >
                  {t('common.install')}
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {kind === 'resourcepacks' && installed.length > 1 && (
            <p className="text-xs text-rf-text-muted">{t('content.orderHint')}</p>
          )}

          {installed.length === 0 ? (
            <EmptyState
              kind="mods"
              title={kind === 'shaders' ? t('content.emptyShaders') : t('content.emptyPacks')}
              hint={t('content.emptyHint')}
            />
          ) : (
            installed.map((item, index) => (
              <div
                key={item.id}
                className="flex items-center gap-3 rounded-lg border border-rf-border bg-rf-surface p-3"
              >
                {kind === 'resourcepacks' && (
                  <div className="flex flex-col">
                    <button
                      onClick={() => void handleMove(index, -1)}
                      disabled={index === 0}
                      aria-label={t('content.moveUp', { name: item.name })}
                      className="text-rf-text-muted hover:text-rf-text disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      onClick={() => void handleMove(index, 1)}
                      disabled={index === installed.length - 1}
                      aria-label={t('content.moveDown', { name: item.name })}
                      className="text-rf-text-muted hover:text-rf-text disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronDown size={14} />
                    </button>
                  </div>
                )}
                <Icon size={18} className="shrink-0 text-rf-text-muted" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-rf-text truncate">{item.name}</p>
                  <p className="text-xs text-rf-text-muted">
                    {item.version} • {item.source}
                    {item.fromManifest && ` • ${t('mods.fromManifest')}`}
                  </p>
                </div>
                {/* Manifest-managed entries are re-added by the next sync, so
                    removing one here would only look like it worked. */}
                {!item.fromManifest && (
                  <Button
                    variant="danger"
                    size="sm"
                    loading={busyId === item.id}
                    onClick={() => void handleRemove(item.id)}
                  >
                    {t('common.remove')}
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/**
 * What happened to the shader loader, said plainly and dismissibly.
 *
 * Separate from the error banner: none of these mean the shader failed to
 * install. They mean the shader will or will not be *usable*, which is a
 * different thing and would be lost if it shared a red box with a download
 * failure.
 */
function LoaderNote({
  note,
  onDismiss,
}: {
  note: ShaderLoaderState | ShaderLoaderResult;
  onDismiss: () => void;
}) {
  const t = useT();

  switch (note.status) {
    case 'installed':
      return (
        <Banner type="info" dismissible onDismiss={onDismiss}>
          {note.dependencies.length > 0
            ? t('content.loaderInstalledWithDeps', {
                name: note.name,
                deps: note.dependencies.join(', '),
              })
            : t('content.loaderInstalled', { name: note.name })}
        </Banner>
      );
    case 'no-build':
      return (
        <Banner type="warning" dismissible onDismiss={onDismiss}>
          {t('content.loaderNoBuild', {
            loader: loaderLabel(note.modLoader),
            version: note.mcVersion,
          })}
        </Banner>
      );
    case 'unsupported':
      return (
        <Banner type="warning" dismissible onDismiss={onDismiss}>
          {t('content.loaderUnsupported')}
        </Banner>
      );
    case 'failed':
      return (
        <Banner type="warning" dismissible onDismiss={onDismiss}>
          {t('content.loaderFailed', { error: note.error })}
        </Banner>
      );
    default:
      return null;
  }
}
