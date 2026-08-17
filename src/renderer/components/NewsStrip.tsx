import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { NewsCard } from '@components/NewsCard';
import { useT } from '@renderer/i18n';
import type { NewsItem } from '@shared/ipc-types';

/** Cards visible at once; the rest of the feed is a scroll away. */
const VISIBLE_CARDS = 4;

/** Must match the row's `gap-3`, in rem. */
const CARD_GAP_REM = 0.75;

/** Split the row evenly, taking the gaps between cards off the top first. */
const CARD_WIDTH = `calc((100% - ${(VISIBLE_CARDS - 1) * CARD_GAP_REM}rem) / ${VISIBLE_CARDS})`;

/**
 * The news row: the four newest entries across the full width, scrollable back
 * through older ones.
 *
 * It used to render `news.slice(0, 4)`: anything the feed published before
 * those four was fetched, parsed and then thrown away. Scrolling keeps the
 * whole feed reachable without giving the home screen a second page.
 *
 * Cards are sized as a fraction of the row rather than at a fixed `w-60`, which
 * left four tiles bunched at the left edge and a growing dead strip on the
 * right at every window width but one. `CARD_WIDTH` derives that fraction from
 * the same two numbers the layout uses, so the count and the gap cannot drift
 * apart.
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
    // A page is exactly the four cards on screen now that they tile the row;
    // snapping takes care of the sub-pixel remainder.
    el.scrollBy({ left: direction * el.clientWidth, behavior: 'smooth' });
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
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-rf-accent-text rounded-lg"
      >
        {items.map((item) => (
          // `min-w` is the floor a quarter of the row may not go below; past it
          // the cards overflow and the arrows appear, rather than shrinking
          // into four unreadable slivers.
          <div key={item.id} style={{ width: CARD_WIDTH }} className="min-w-40 shrink-0 snap-start">
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
