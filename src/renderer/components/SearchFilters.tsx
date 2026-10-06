// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { Select } from '@components/ui/Select';
import { tagLabel } from '@shared/labels';
import { useT } from '@renderer/i18n';
import type { FacetGroups } from '@shared/ipc-types';

/**
 * What the user has narrowed the search to. Empty string means "any" in every
 * field, so a fresh state is an unfiltered search.
 */
export interface SearchFilterState {
  gameVersion: string;
  loader: string;
  /** One chosen value per Modrinth facet header, keyed by header. */
  categories: Record<string, string>;
}

export const EMPTY_FILTERS: SearchFilterState = { gameVersion: '', loader: '', categories: {} };

/**
 * The facet values a search should send, in the one field Modrinth files them
 * under — loaders included, because Modrinth stores them as categories too.
 */
export function filterCategories(state: SearchFilterState): string[] {
  return [state.loader, ...Object.values(state.categories)].filter(Boolean);
}

/**
 * The same, minus the loader — for searches that carry the loader in its own
 * typed field rather than folding it in with the category tags.
 */
export function categoriesWithoutLoader(state: SearchFilterState): string[] {
  return Object.values(state.categories).filter(Boolean);
}

/**
 * Modrinth's header names are lowercase English with a space in one of them.
 * Translate the known ones and fall back to the raw header, so a header
 * Modrinth adds tomorrow shows up as itself rather than vanishing.
 */
function headerLabel(t: ReturnType<typeof useT>, header: string): string {
  switch (header) {
    case 'resolutions':
      return t('content.facet.resolutions');
    case 'features':
      return t('content.facet.features');
    case 'categories':
      return t('content.facet.categories');
    case 'performance impact':
      return t('content.facet.performanceImpact');
    default:
      return tagLabel(header);
  }
}

interface Option {
  value: string;
  label: string;
}

/**
 * The options of a filter, always including the one that is in force.
 *
 * A filter can hold a value its list does not: the profile's Minecraft version
 * when that is a snapshot, or any value at all while the lists could not be
 * fetched. A `<select>` then has nothing to show for it and shows its first
 * option — "Any" — over a search that is being narrowed all the same, and
 * picking "Any" does nothing, being what the control already says.
 */
function optionsWith(
  current: string,
  any: Option,
  values: string[],
  labelOf: (value: string) => string = (value) => value,
): Option[] {
  const all = !current || values.includes(current) ? values : [current, ...values];
  return [any, ...all.map((value) => ({ value, label: labelOf(value) }))];
}

interface Props {
  facets: FacetGroups;
  value: SearchFilterState;
  onChange: (next: SearchFilterState) => void;
  /** Label for the loader control — mods and shaders mean different things by it. */
  loaderLabel: string;
  /** Resource packs have exactly one loader (`minecraft`), so the control is noise. */
  showLoader?: boolean;
}

/**
 * The filter row shared by the mods and the shaders / resource-packs browsers.
 *
 * It exists because these filters are not decoration: Modrinth ANDs across facet
 * groups, so a search pinned to a Minecraft version and a loader genuinely
 * returns nothing for a mod that has no build for that pair. Hiding that
 * pinning — as the mods page used to, silently inheriting it from the profile —
 * turns a correct empty result into an apparently broken search.
 */
export function SearchFilters({ facets, value, onChange, loaderLabel, showLoader = true }: Props) {
  const t = useT();
  const any = { value: '', label: t('content.filterAny') };

  return (
    <div className="flex flex-wrap gap-2">
      <div className="min-w-36 flex-1">
        <Select
          label={t('search.gameVersion')}
          options={optionsWith(value.gameVersion, any, facets.gameVersions)}
          value={value.gameVersion}
          onChange={(e) => onChange({ ...value, gameVersion: e.target.value })}
        />
      </div>

      {/* Drawn whenever a loader is in force, list or no list: without the
          control there is nothing to see the filter by, and nothing to lift it
          with. */}
      {showLoader && (facets.loaders.length > 0 || value.loader) && (
        <div className="min-w-36 flex-1">
          <Select
            label={loaderLabel}
            options={optionsWith(value.loader, any, facets.loaders, tagLabel)}
            value={value.loader}
            onChange={(e) => onChange({ ...value, loader: e.target.value })}
          />
        </div>
      )}

      {/* One control per Modrinth header. They are different questions — how
          sharp, what it touches, what it looks like — and a single flat list
          cannot express "32x AND vanilla-like". */}
      {facets.groups.map((group) => (
        <div key={group.header} className="min-w-36 flex-1">
          <Select
            label={headerLabel(t, group.header)}
            options={optionsWith(value.categories[group.header] ?? '', any, group.names, tagLabel)}
            value={value.categories[group.header] ?? ''}
            onChange={(e) =>
              onChange({
                ...value,
                categories: { ...value.categories, [group.header]: e.target.value },
              })
            }
          />
        </div>
      ))}
    </div>
  );
}
