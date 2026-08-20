import { useCallback, useEffect, useState } from 'react';
import { Archive, RotateCcw, Trash2, Save } from 'lucide-react';
import { Button } from '@components/ui/Button';
import { Banner } from '@components/ui/Banner';
import { formatBytes } from '@renderer/format';
import { useLocale, useT } from '@renderer/i18n';
import type { WorldBackup } from '@shared/ipc-types';

const api = window.ravenforge;

/**
 * A profile's worlds, and the copies taken of them.
 *
 * Worlds are the only thing in a profile that cannot be downloaded again, and
 * this is the only place in the launcher that acknowledges it. The list is not
 * decoration: a restore replaces `saves/` wholesale, and the only reason that is
 * safe to offer is that the launcher copies what it is about to replace — which
 * is a promise the player has to be able to see kept.
 */
export function WorldBackupCard({ profileId }: { profileId: string }) {
  const t = useT();
  const locale = useLocale();
  const [worlds, setWorlds] = useState<string[]>([]);
  const [backups, setBackups] = useState<WorldBackup[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** The backup whose "are you sure" is showing; restoring replaces live worlds. */
  const [confirming, setConfirming] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [w, b] = await Promise.all([
      api.profiles.listWorlds(profileId),
      api.profiles.listBackups(profileId),
    ]);
    setWorlds(w.success && w.data ? w.data : []);
    setBackups(b.success && b.data ? b.data : []);
  }, [profileId]);

  useEffect(() => {
    setError(null);
    setNote(null);
    setConfirming(null);
    void reload();
  }, [reload]);

  const act = async (run: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const failure = await run();
      if (failure) setError(failure);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const backUp = () =>
    act(async () => {
      const r = await api.profiles.backupWorlds(profileId);
      if (!r.success) return r.error ?? t('worlds.backupFailed');
      setNote(t('worlds.backedUp'));
      return null;
    });

  const restore = (backupId: string) =>
    act(async () => {
      setConfirming(null);
      const r = await api.profiles.restoreBackup(profileId, backupId);
      if (!r.success) return r.error ?? t('worlds.restoreFailed');
      // `data` is the copy taken of what was just replaced — the reason this is
      // recoverable, so it is what gets said rather than a bare "done".
      setNote(r.data ? t('worlds.restoredWithSafety') : t('worlds.restored'));
      return null;
    });

  const remove = (backupId: string) =>
    act(async () => {
      const r = await api.profiles.deleteBackup(profileId, backupId);
      return r.success ? null : (r.error ?? t('worlds.deleteFailed'));
    });

  return (
    <div className="space-y-3 rounded-lg border border-rf-border bg-rf-surface p-3">
      <div className="flex items-center gap-2">
        <Archive size={15} className="shrink-0 text-rf-text-muted" aria-hidden="true" />
        <h3 className="flex-1 text-xs font-display font-semibold uppercase tracking-wider text-rf-text-secondary">
          {t('worlds.title')}
        </h3>
        <Button
          variant="secondary"
          size="sm"
          icon={<Save size={12} />}
          loading={busy}
          disabled={worlds.length === 0}
          onClick={() => void backUp()}
        >
          {t('worlds.backupNow')}
        </Button>
      </div>

      <p className="text-xs text-rf-text-muted">
        {worlds.length === 0 ? t('worlds.none') : worlds.join(' • ')}
      </p>

      {error && <Banner type="urgent">{error}</Banner>}
      {note && (
        <Banner type="info" dismissible onDismiss={() => setNote(null)}>
          {note}
        </Banner>
      )}

      {backups.length === 0 ? (
        <p className="text-xs text-rf-text-muted">{t('worlds.noBackups')}</p>
      ) : (
        <ul className="space-y-1.5">
          {backups.map((backup) => (
            <li
              key={backup.id}
              className="flex items-center gap-2 rounded border border-rf-border px-2.5 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-rf-text">
                  {new Date(backup.createdAt).toLocaleString(locale)}
                  {' • '}
                  {t(`worlds.reason.${backup.reason}`)}
                </p>
                <p className="truncate text-xs text-rf-text-muted">
                  {backup.worlds.join(', ')} • {formatBytes(backup.bytes)}
                </p>
              </div>

              {confirming === backup.id ? (
                <>
                  <span className="text-xs text-rf-danger">{t('worlds.confirmRestore')}</span>
                  <Button size="sm" loading={busy} onClick={() => void restore(backup.id)}>
                    {t('worlds.confirmRestoreYes')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                    {t('common.cancel')}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<RotateCcw size={12} />}
                    onClick={() => setConfirming(backup.id)}
                    title={t('worlds.restore')}
                  />
                  <Button
                    variant="danger"
                    size="sm"
                    icon={<Trash2 size={12} />}
                    loading={busy}
                    onClick={() => void remove(backup.id)}
                    title={t('common.delete')}
                  />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
