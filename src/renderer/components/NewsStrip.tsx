import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { NewsCard } from '@components/NewsCard';
import { useT } from '@renderer/i18n';
import type { NewsItem } from '@shared/ipc-types';

/**
 * The news row, scrollable back through older entries.
 *
 * It used to render `news.slice(0, 4)`: anything the feed published before
 * those four was fetched, parsed and then thrown away. Scrolling keeps the
 * whole feed reachable without giving the home screen a second page.
 *
 * The arrows are an addition to native scrolling, not a replacement for it —
 * the container still scrolls by wheel, trackpad and keyboard, which is what a
 * scrollbar-less design would otherwise take away.
 */
export function NewsStrip({
  items,
  onOpen,
}: {
  items: NewsItem[];
  onOpen: (item: NewsItem) => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // A pixel of slack: fractional widths mean scrollLeft rarely lands exactly
    // on the maximum, which would leave the arrow enabled with nowhere to go.
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
  }, []);

  // Re-measured on resize as well as on content: the same four cards fit in a
  // maximised window and overflow in a narrow one.
  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, items]);

  const page = (direction: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  // Nothing overflows: no arrows, rather than two dead controls.
  const scrollable = !(atStart && atEnd);

  return (
    <div className="relative">
      <div
        ref={ref}
        onScroll={measure}
        // Focusable so the arrow keys reach it; a scroll region that only
        // responds to a mouse is a scroll region some people cannot use.
        tabIndex={0}
        role="group"
        aria-label={t('home.news')}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-rf-accent rounded-lg"
      >
        {items.map((item) => (
          <div key={item.id} className="w-60 shrink-0 snap-start">
            <NewsCard item={item} onOpen={() => onOpen(item)} />
          </div>
        ))}
      </div>

      {scrollable && (
        <>
          {/* The feed is newest-first, so right is backwards in time. Labelling
              these "previous/next" would be ambiguous about which. */}
          <PageButton
            side="left"
            disabled={atStart}
            label={t('home.newsNewer')}
            onClick={() => page(-1)}
          />
          <PageButton
            side="right"
            disabled={atEnd}
            label={t('home.newsOlder')}
            onClick={() => page(1)}
          />
        </>
      )}
    </div>
  );
}

function PageButton({
  side,
  disabled,
  label,
  onClick,
}: {
  side: 'left' | 'right';
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`absolute top-1/2 -translate-y-1/2 rounded-full border border-rf-border bg-rf-surface/90 p-1.5 text-rf-text-secondary shadow-lg backdrop-blur transition-opacity hover:text-rf-text disabled:pointer-events-none disabled:opacity-0 ${
        side === 'left' ? '-left-2' : '-right-2'
      }`}
    >
      <Icon size={16} />
    </button>
  );
}
