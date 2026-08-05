import { Check } from 'lucide-react';
import { useT } from '@renderer/i18n';

/**
 * Takes the place of the Install button once the thing is in the profile.
 *
 * Not a disabled Install button: greyed-out reads as "you cannot have this",
 * and the truth is the opposite. Left enabled it was worse — the search list
 * has no idea what the profile already holds, so pressing it again downloaded
 * the same build and overwrote a file that was already correct.
 */
export function InstalledMark() {
  const t = useT();

  return (
    <span className="flex shrink-0 items-center gap-1 rounded border border-rf-success/30 bg-rf-success/10 px-2 py-1 text-xs font-medium text-rf-success">
      <Check size={13} aria-hidden="true" />
      {t('common.installed')}
    </span>
  );
}
