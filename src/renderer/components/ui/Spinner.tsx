import forgeSpinner from '@assets/animations/forge-spinner.svg?raw';
import { InlineSvg } from '@components/ui/InlineSvg';

interface SpinnerProps {
  /** Rendered next to the mark; also the accessible label. */
  label?: string;
  className?: string;
}

/**
 * Indeterminate loading indicator, for waits with no percentage to report.
 *
 * Inlined rather than served through `<img>` so the artwork's own
 * `prefers-reduced-motion` rule can see the user's setting — an SVG inside an
 * `<img>` is an isolated document and would keep animating regardless.
 */
export function Spinner({ label, className = '' }: SpinnerProps) {
  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <InlineSvg markup={forgeSpinner} className="h-10 text-rf-text-secondary" label={label} />
      {label && <span className="text-sm text-rf-text-muted">{label}</span>}
    </div>
  );
}
