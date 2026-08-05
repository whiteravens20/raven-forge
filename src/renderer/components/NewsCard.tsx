import { useState } from 'react';
import iconMono from '@assets/icons/icon-mono.svg?raw';
import { InlineSvg } from '@components/ui/InlineSvg';
import type { NewsItem } from '@shared/ipc-types';

/**
 * One news tile.
 *
 * A remote feed's images are outside our control, so a missing `imageUrl` and
 * an `imageUrl` that 404s have to land in the same place: the placeholder.
 * Reacting only to the missing field leaves a broken-image icon on screen.
 */
export function NewsCard({ item, onOpen }: { item: NewsItem; onOpen: () => void }) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(item.imageUrl) && !imageFailed;

  return (
    <button
      onClick={onOpen}
      className="flex flex-col gap-1 rounded-lg border border-rf-border bg-rf-surface p-3 text-left transition-colors hover:border-rf-accent/50"
    >
      <div className="mb-1 h-20 w-full overflow-hidden rounded bg-rf-bg-tertiary">
        {showImage ? (
          <img
            src={item.imageUrl}
            alt=""
            loading="lazy"
            onError={() => setImageFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <NewsPlaceholder />
        )}
      </div>

      <h3 className="line-clamp-1 text-sm font-medium text-rf-text">{item.title}</h3>
      <p className="line-clamp-2 text-xs text-rf-text-muted">{item.excerpt}</p>
    </button>
  );
}

/**
 * Stand-in artwork, so a feed without images still looks intentional. Built
 * in the DOM rather than shipped as an image: an `<img>`-referenced SVG is
 * an isolated document stuck with hardcoded colors, which turned into a
 * black slab on the light theme. Composed from theme surfaces + the mono
 * mark, it sits right in all three.
 */
function NewsPlaceholder() {
  return (
    <div
      aria-hidden="true"
      className="relative h-full w-full bg-gradient-to-br from-rf-bg-tertiary via-rf-bg-secondary to-rf-bg-tertiary"
    >
      <div className="absolute inset-0 bg-gradient-to-tl from-rf-accent/15 to-transparent" />
      <InlineSvg
        markup={iconMono}
        className="absolute bottom-1.5 right-2 h-8 text-rf-text-muted opacity-40"
      />
    </div>
  );
}
