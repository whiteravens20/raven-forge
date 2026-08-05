import { AlertTriangle } from 'lucide-react';
import { acceptedLoaders } from '@shared/constants';
import { loaderLabel } from '@shared/labels';
import { useT } from '@renderer/i18n';
import type { ModSearchResult } from '@shared/ipc-types';

interface Props {
  item: ModSearchResult;
  /** The profile's Minecraft version, if it has one pinned. */
  gameVersion?: string;
  /** The profile's mod loader. Omitted for resource packs, which have none. */
  modLoader?: string;
}

/**
 * A warning on a search result, from what the search already returned.
 *
 * Costs nothing: a Modrinth hit carries the union of every Minecraft version and
 * every loader across all of a project's builds, so a missing entry is proof
 * that no build has it. That makes this a reliable *negative* test and nothing
 * more — a project listing both `fabric` and `1.21.4` may still have no build
 * that is both, which only the pre-install check can tell. So this stays quiet
 * unless it is certain, and the check does the rest when Install is pressed.
 */
export function CompatibilityBadge({ item, gameVersion, modLoader }: Props) {
  const t = useT();

  const wrongVersion = Boolean(gameVersion) && !item.versions.includes(gameVersion!);
  const loaders = modLoader ? acceptedLoaders(modLoader) : [];
  // Modrinth files loaders under `categories`, alongside genuine tags.
  const wrongLoader =
    loaders.length > 0 && !loaders.some((loader) => item.categories.includes(loader));

  if (!wrongVersion && !wrongLoader) return null;

  return (
    <span className="mt-1 inline-flex items-center gap-1 rounded border border-rf-warning/30 bg-rf-warning/10 px-1.5 py-0.5 text-xs text-rf-warning">
      <AlertTriangle size={11} aria-hidden="true" />
      {wrongVersion
        ? t('compat.badgeVersion', { version: gameVersion! })
        : t('compat.badgeLoader', { loader: loaderLabel(modLoader!) })}
    </span>
  );
}
