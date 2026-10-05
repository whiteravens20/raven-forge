// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { useEffect, useRef } from 'react';
import { ExternalLink, Package } from 'lucide-react';
import { Button } from '@components/ui/Button';
import { useLocale, useT } from '@renderer/i18n';
import { modrinthProjectUrl } from '@shared/constants';
import type { InstalledMod, ModSearchResult, ProjectDetails } from '@shared/ipc-types';

const api = window.ravenforge;

/**
 * One search hit, drawn the same way wherever Modrinth is searched.
 *
 * The mods page, the shaders and resource-packs page and the modpack picker
 * each had their own copy of this row, and they had begun to differ. `children`
 * is whatever sits under the description — the compatibility badge, where there
 * is a profile to judge against — and `action` is the button on the right.
 */
export function SearchResultRow({
  item,
  fallbackIcon,
  children,
  action,
}: {
  item: ModSearchResult;
  /** Shown when the project has no icon of its own. */
  fallbackIcon?: React.ReactNode;
  children?: React.ReactNode;
  action: React.ReactNode;
}) {
  const t = useT();
  const locale = useLocale();

  return (
    <div className="flex items-center gap-3 rounded-lg border border-rf-border bg-rf-surface p-3">
      {item.iconUrl ? (
        <img src={item.iconUrl} alt="" className="h-10 w-10 shrink-0 rounded" />
      ) : (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-rf-bg-tertiary">
          {fallbackIcon ?? <Package size={18} className="text-rf-text-muted" />}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-medium text-rf-text">
          <span className="truncate">{item.name}</span>
          <ProjectLink slug={item.slug} name={item.name} />
        </p>
        {/* Two lines, not one: the description is how a player tells this mod
            from the three others with nearly its name, and a single truncated
            line cut most of them off before they said anything. */}
        <p className="line-clamp-2 text-xs text-rf-text-muted">{item.description}</p>
        <p className="text-xs text-rf-text-muted">
          {item.author} •{' '}
          {t.plural('mods.downloads', item.downloads, {
            count: item.downloads.toLocaleString(locale),
          })}
        </p>
        {children}
      </div>
      {action}
    </div>
  );
}

/** A small way out to the project's own page, opened in the system browser. */
export function ProjectLink({ slug, name }: { slug: string; name: string }) {
  const t = useT();
  const label = t('search.openProject', { name });
  return (
    <button
      onClick={() => void api.system.openUrl(modrinthProjectUrl(slug))}
      aria-label={label}
      title={label}
      className="shrink-0 text-rf-text-muted hover:text-rf-accent-text"
    >
      <ExternalLink size={12} />
    </button>
  );
}

/**
 * The foot of a result list: how much of it is on screen, and the way to more.
 *
 * Both ways at once. Scrolling to the end loads the next page on its own, which
 * is what most people expect of a long list; the button is there for the list
 * that fits without scrolling, for a keyboard, and as the visible statement
 * that there *is* more — a list that silently grows is easy to mistake for one
 * that has ended.
 */
export function SearchPager({
  shown,
  total,
  hasMore,
  loading,
  onMore,
}: {
  shown: number;
  total: number;
  hasMore: boolean;
  loading: boolean;
  onMore: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const sentinel = useRef<HTMLDivElement>(null);

  // The callback is kept in a ref so the observer is not torn down and rebuilt
  // every time the page re-renders around it.
  const more = useRef(onMore);
  more.current = onMore;

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) more.current();
      },
      // Begin a little before the end comes into view, so the next page is
      // usually there by the time the eye is.
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
    // `shown` is here on purpose: a page that did not push the sentinel out of
    // view produces no new intersection event, so the observer is re-armed
    // after each one and reports the sentinel still being visible.
  }, [hasMore, shown]);

  if (shown === 0) return null;

  return (
    <div className="flex flex-col items-center gap-2 py-2">
      <p className="text-xs text-rf-text-muted" role="status">
        {t('search.shown', {
          shown: shown.toLocaleString(locale),
          total: total.toLocaleString(locale),
        })}
      </p>
      {hasMore && (
        <>
          <Button variant="secondary" size="sm" loading={loading} onClick={onMore}>
            {t('search.loadMore')}
          </Button>
          <div ref={sentinel} aria-hidden="true" />
        </>
      )}
    </div>
  );
}

/**
 * What an installed mod, shader or resource pack is: its icon, its name, a way
 * to its page, and a sentence about what it does.
 *
 * `details` arrives after the row is first drawn, and for a file Modrinth has
 * never seen it never arrives — so everything here that depends on it is
 * simply left out until it does, and the row never waits.
 */
export function InstalledEntryInfo({
  entry,
  details,
  fallbackIcon,
  children,
}: {
  entry: InstalledMod;
  details?: ProjectDetails;
  fallbackIcon: React.ReactNode;
  /** The line of facts under the description: version, origin, update. */
  children: React.ReactNode;
}) {
  return (
    <>
      {details?.iconUrl ? (
        <img src={details.iconUrl} alt="" className="h-8 w-8 shrink-0 rounded" />
      ) : (
        fallbackIcon
      )}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-medium text-rf-text">
          <span className="truncate">{entry.name}</span>
          {details && <ProjectLink slug={details.slug} name={entry.name} />}
        </p>
        {details?.description && (
          <p className="line-clamp-2 text-xs text-rf-text-muted">{details.description}</p>
        )}
        <p className="text-xs text-rf-text-muted">{children}</p>
      </div>
    </>
  );
}
