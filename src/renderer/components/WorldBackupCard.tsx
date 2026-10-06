// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, RotateCcw, Trash2, Save } from 'lucide-react';
import { Button } from '@components/ui/Button';
import { ConfirmButton } from '@components/ui/ConfirmButton';
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

  // The profile this card is showing now. A copy of a large world takes long
  // enough to select another profile in, and what it then reported — the first
  // profile's worlds, its backups, "backed up" — used to land on the second.
  const shown = useRef(profileId);
  useEffect(() => {
    shown.current = profileId;
  }, [profileId]);

  const reload = useCallback(async () => {
    const [w, b] = await Promise.all([
      api.profiles.listWorlds(profileId),
      api.profiles.listBackups(profileId),
    ]);
    if (shown.current !== profileId) return;
    setWorlds(w.success && w.data ? w.data : []);
    setBackups(b.success && b.data ? b.data : []);
  }, [profileId]);

  useEffect(() => {
    setError(null);
    setNote(null);
    setConfirming(null);
    setBusy(false);
    void reload();
  }, [reload]);

  // A session is where worlds come from: the list read before it is not the
  // list after it.
  useEffect(
    () =>
      api.on('game:exited', (info) => {
        if (info.profileId === profileId) void reload();
      }),
    [profileId, reload],
  );

  /** Run one action on this profile, and report it only if it is still the one shown. */
  const act = async (run: () => Promise<{ failure?: string; note?: string }>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    const outcome = await run().catch((err: unknown) => ({
      failure: err instanceof Error ? err.message : String(err),
      note: undefined,
    }));
    if (shown.current !== profileId) return;
    if (outcome.failure) setError(outcome.failure);
    else if (outcome.note) setNote(outcome.note);
    await reload();
    setBusy(false);
  };

  const backUp = () =>
    act(async () => {
      const r = await api.profiles.backupWorlds(profileId);
      if (!r.success) return { failure: r.error ?? t('worlds.backupFailed') };
      return { note: t('worlds.backedUp') };
    });

  const restore = (backupId: string) =>
    act(async () => {
      setConfirming(null);
      const r = await api.profiles.restoreBackup(profileId, backupId);
      if (!r.success) return { failure: r.error ?? t('worlds.restoreFailed') };
      // `data` is the copy taken of what was just replaced — the reason this is
      // recoverable, so it is what gets said rather than a bare "done".
      return { note: r.data ? t('worlds.restoredWithSafety') : t('worlds.restored') };
    });

  const remove = (backupId: string) =>
    act(async () => {
      const r = await api.profiles.deleteBackup(profileId, backupId);
      return r.success ? {} : { failure: r.error ?? t('worlds.deleteFailed') };
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
                  <ConfirmButton
                    icon={<Trash2 size={12} />}
                    title={t('common.delete')}
                    question={t('worlds.confirmDelete')}
                    confirmLabel={t('common.delete')}
                    loading={busy}
                    onConfirm={() => void remove(backup.id)}
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
