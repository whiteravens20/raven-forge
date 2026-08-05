import noProfiles from '@assets/empty-states/no-profiles.svg?raw';
import noMods from '@assets/empty-states/no-mods.svg?raw';
import { InlineSvg } from '@components/ui/InlineSvg';

const ILLUSTRATIONS = {
  profiles: noProfiles,
  mods: noMods,
} as const;

interface EmptyStateProps {
  kind: keyof typeof ILLUSTRATIONS;
  title: string;
  /** One line explaining the way out of the empty state. */
  hint?: string;
  className?: string;
}

/**
 * Illustrated placeholder for a list with nothing in it. The artwork is drawn
 * in `currentColor`, so it is inlined rather than served through `<img>` and
 * picks up whichever theme is active.
 */
export function EmptyState({ kind, title, hint, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 p-8 text-center ${className}`}>
      <InlineSvg markup={ILLUSTRATIONS[kind]} className="h-24 text-rf-text-muted opacity-70" />
      <div>
        <p className="text-sm text-rf-text-secondary">{title}</p>
        {hint && <p className="mt-1 text-xs text-rf-text-muted">{hint}</p>}
      </div>
    </div>
  );
}
