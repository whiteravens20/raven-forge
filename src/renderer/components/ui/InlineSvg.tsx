interface InlineSvgProps {
  /** Raw markup from a `?raw` import. */
  markup: string;
  className?: string;
  /** Exposed to assistive tech when the graphic carries meaning. */
  label?: string;
}

/**
 * Inlines an SVG into the DOM instead of pointing an `<img>` at it.
 *
 * Necessary for every asset drawn with `currentColor`: an `<img>`-referenced
 * SVG is an isolated document and does not inherit the page's colour, so those
 * files render black regardless of the theme. Inlining is also what lets the
 * spinner's internal `@media (prefers-reduced-motion)` see the user's setting.
 *
 * The markup is a build-time import of a file in this repo — never user input —
 * so `dangerouslySetInnerHTML` carries no injection risk here.
 */
export function InlineSvg({ markup, className = '', label }: InlineSvgProps) {
  return (
    <span
      // Height drives the size and width follows the viewBox, so non-square
      // art (the wordmark) keeps its proportions without per-use overrides.
      className={`inline-flex items-center [&>svg]:h-full [&>svg]:w-auto ${className}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
