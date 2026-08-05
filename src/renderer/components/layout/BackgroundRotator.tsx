import { useEffect, useRef, useState } from 'react';

interface BackgroundRotatorProps {
  /** URLs / file paths cycled in order. */
  images: string[];
  /** Crossfade duration in ms. */
  fadeMs?: number;
  /** Hold time per image in ms. */
  holdMs?: number;
  /** Subtle parallax on mouse move (default true). */
  parallax?: boolean;
}

/**
 * Full-bleed crossfading hero image rotator. Two stacked layers swap their
 * background-image and opacity to produce a seamless transition without
 * loading flashes.
 */
export function BackgroundRotator({
  images,
  fadeMs = 1200,
  holdMs = 8000,
  parallax = true,
}: BackgroundRotatorProps) {
  const [index, setIndex] = useState(0);
  const [showB, setShowB] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (images.length <= 1) return;
    const interval = setInterval(() => {
      setIndex((prev) => (prev + 1) % images.length);
      setShowB((prev) => !prev);
    }, holdMs);
    return () => clearInterval(interval);
  }, [images.length, holdMs]);

  useEffect(() => {
    if (!parallax) return;
    const node = containerRef.current;
    if (!node) return;
    const handler = (e: MouseEvent) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 12;
      const y = (e.clientY / window.innerHeight - 0.5) * 12;
      node.style.setProperty('--rf-bg-x', `${x}px`);
      node.style.setProperty('--rf-bg-y', `${y}px`);
    };
    window.addEventListener('mousemove', handler);
    return () => window.removeEventListener('mousemove', handler);
  }, [parallax]);

  if (images.length === 0) return null;

  // Layer A holds even-indexed images, layer B holds odd ones; opacity flips.
  // NOTE: the url() below must stay quoted. Bundled backgrounds are inlined as
  // `data:image/svg+xml,...` whose payload contains `url(#gradient)`
  // references; those unescaped parentheses close an unquoted CSS url() early,
  // and the browser then drops the declaration entirely.
  const a = showB ? images[(index + images.length - 1) % images.length] : images[index];
  const b = showB ? images[index] : images[(index + images.length - 1) % images.length];

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      aria-hidden
    >
      <div
        className="absolute inset-0 bg-cover bg-center transition-opacity"
        style={{
          backgroundImage: `url("${a}")`,
          opacity: showB ? 0 : 1,
          transitionDuration: `${fadeMs}ms`,
          transform: 'translate(var(--rf-bg-x, 0), var(--rf-bg-y, 0)) scale(1.04)',
        }}
      />
      <div
        className="absolute inset-0 bg-cover bg-center transition-opacity"
        style={{
          backgroundImage: `url("${b}")`,
          opacity: showB ? 1 : 0,
          transitionDuration: `${fadeMs}ms`,
          transform: 'translate(var(--rf-bg-x, 0), var(--rf-bg-y, 0)) scale(1.04)',
        }}
      />
      {/* Scrim kept light: the bundled artwork already holds its centre band
          dark for the launch button, so stacking a near-opaque wash on top of
          it erased the backgrounds entirely. Weight it towards the bottom,
          where the news strip needs the contrast. */}
      <div className="absolute inset-0 bg-gradient-to-b from-rf-bg/20 via-rf-bg/45 to-rf-bg/90" />
    </div>
  );
}
