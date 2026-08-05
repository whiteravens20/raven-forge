import { useEffect, useState } from 'react';
import { Trash2, X, AlertTriangle } from 'lucide-react';
import { Button } from '@components/ui/Button';
import { formatBytes } from '@renderer/format';
import { useT } from '@renderer/i18n';
import type { ProfileFileSummary } from '@shared/ipc-types';

const api = window.ravenforge;

interface Props {
  profileId: string;
  profileName: string;
  onCancel: () => void;
  onConfirm: (deleteFiles: boolean) => void;
}

/**
 * Confirms deleting a profile, and asks the question the old `confirm()` did not.
 *
 * Deleting a profile used to remove its whole directory without saying so — mods,
 * shaders, resource packs, configs and, the part that matters, world saves. Every
 * one of those except the saves can be downloaded again. So the choice is put in
 * front of the player with the actual contents counted, and unlisting the profile
 * while leaving the files is a real option with an address to find them at.
 */
export function ProfileDeleteDialog({ profileId, profileName, onCancel, onConfirm }: Props) {
  const t = useT();
  const [deleteFiles, setDeleteFiles] = useState(true);
  const [summary, setSummary] = useState<ProfileFileSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.profiles.getFileSummary(profileId).then((r) => {
      if (!cancelled && r.success && r.data) setSummary(r.data);
    });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // Empty categories are left out rather than shown as zeroes: "0 shaders" is a
  // line to read past, and the list exists to be read.
  const counts = summary
    ? (
        [
          ['delete.mods', summary.mods],
          ['delete.resourcePacks', summary.resourcePacks],
          ['delete.shaders', summary.shaders],
        ] as const
      ).filter(([, n]) => n > 0)
    : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      role="presentation"
    >
      <div
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-rf-border bg-rf-bg-secondary shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-profile-title"
      >
        <header className="flex items-center gap-2 border-b border-rf-border px-5 py-3">
          <Trash2 size={15} className="shrink-0 text-rf-danger" />
          <h2 id="delete-profile-title" className="flex-1 text-sm font-display font-semibold">
            {t('delete.title', { name: profileName })}
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
          <p className="text-sm text-rf-text-secondary">{t('delete.intro')}</p>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-rf-border p-3 transition-colors hover:border-rf-danger/50">
            <input
              type="checkbox"
              checked={deleteFiles}
              onChange={(e) => setDeleteFiles(e.target.checked)}
              className="mt-0.5 accent-rf-danger"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-rf-text">
                {t('delete.alsoFiles')}
              </span>
              <span className="mt-0.5 block text-xs text-rf-text-muted">
                {summary
                  ? counts.length > 0 || summary.worlds > 0
                    ? [
                        ...counts.map(([key, n]) => t.plural(key, n)),
                        ...(summary.worlds > 0 ? [t.plural('delete.worlds', summary.worlds)] : []),
                      ].join(' • ') + ` • ${formatBytes(summary.bytes)}`
                    : t('delete.nothingInstalled', { size: formatBytes(summary.bytes) })
                  : t('delete.counting')}
              </span>
            </span>
          </label>

          {/* Worlds are the only thing in a profile that exists nowhere else. */}
          {deleteFiles && summary && summary.worlds > 0 && (
            <p className="flex items-start gap-2 rounded-lg border border-rf-danger/30 bg-rf-danger/10 px-3 py-2 text-sm text-rf-danger">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{t.plural('delete.worldsWarning', summary.worlds)}</span>
            </p>
          )}

          {!deleteFiles && summary && (
            <p className="text-xs text-rf-text-muted">
              {t('delete.keptAt', { path: summary.path })}
            </p>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-rf-border px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" size="sm" onClick={() => onConfirm(deleteFiles)}>
            {deleteFiles ? t('delete.confirmWithFiles') : t('delete.confirmKeepFiles')}
          </Button>
        </footer>
      </div>
    </div>
  );
}
