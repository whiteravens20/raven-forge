import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@components/ui/Button';
import { useT } from '@renderer/i18n';
import type { ProfileFileSummary } from '@shared/ipc-types';

interface Props {
  from: string;
  to: string;
  summary: ProfileFileSummary;
  onCancel: () => void;
  onConfirm: (backupFirst: boolean) => void;
}

/**
 * The guard on the most dangerous thing the profile editor offers.
 *
 * Changing a profile's Minecraft version used to save like any other edit. It
 * is not like any other edit: the mods stay where they are and were built for
 * the version being left, and — the part that does not come back — Minecraft
 * upgrades a world's format the first time a newer version opens it, after
 * which the older version will not open it at all.
 *
 * So the two consequences are stated in the terms of this profile, with the
 * counts it actually has, and the copy is offered here rather than left as
 * something to remember to do first.
 */
export function VersionChangeDialog({ from, to, summary, onCancel, onConfirm }: Props) {
  const t = useT();
  // Ticked wherever there is something to lose, which is the answer almost
  // everybody wants and nobody thinks of in time.
  const [backupFirst, setBackupFirst] = useState(summary.worlds > 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      role="presentation"
    >
      <div
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-rf-border bg-rf-bg-secondary shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="version-change-title"
      >
        <header className="flex items-center gap-2 border-b border-rf-border px-5 py-3">
          <AlertTriangle size={15} className="shrink-0 text-rf-warning" aria-hidden="true" />
          <h2 id="version-change-title" className="flex-1 text-sm font-display font-semibold">
            {t('versionChange.title', { from, to })}
          </h2>
          <button
            onClick={onCancel}
            aria-label={t('common.close')}
            className="text-rf-text-muted hover:text-rf-text"
          >
            <X size={16} />
          </button>
        </header>

        <div className="space-y-3 px-5 py-4">
          {summary.mods > 0 && (
            <p className="text-sm text-rf-text-secondary">
              {t.plural('versionChange.mods', summary.mods, { from })}
            </p>
          )}

          {summary.worlds > 0 && (
            <p className="flex items-start gap-2 rounded-lg border border-rf-danger/30 bg-rf-danger/10 px-3 py-2 text-sm text-rf-danger">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{t.plural('versionChange.worlds', summary.worlds)}</span>
            </p>
          )}

          {summary.worlds > 0 && (
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-rf-border p-3 transition-colors hover:border-rf-accent-text/50">
              <input
                type="checkbox"
                checked={backupFirst}
                onChange={(e) => setBackupFirst(e.target.checked)}
                className="mt-0.5 accent-rf-accent"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-rf-text">
                  {t('versionChange.backupFirst')}
                </span>
                <span className="mt-0.5 block text-xs text-rf-text-muted">
                  {t('versionChange.backupHint')}
                </span>
              </span>
            </label>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-rf-border px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={() => onConfirm(backupFirst && summary.worlds > 0)}>
            {t('versionChange.confirm')}
          </Button>
        </footer>
      </div>
    </div>
  );
}
