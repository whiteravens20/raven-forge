// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, FolderOpen, HardDrive, X } from 'lucide-react';
import { Button } from '@components/ui/Button';
import { useT } from '@renderer/i18n';
import { formatBytes } from '@renderer/format';
import type {
  DataRootInfo,
  DataRootMoveResult,
  DataRootPlan,
  ProgressEvent,
} from '@shared/ipc-types';
import { useDialogFocus } from '@hooks/use-dialog-focus';

const api = window.ravenforge;

/** Long enough to read "done, restarting" before the window goes. */
const RESTART_DELAY_MS = 1200;

/**
 * The data folder, and the way out of the system drive.
 *
 * Profiles, mods, game assets and the managed JREs are several gigabytes and
 * used to have nowhere else to be. The move is offered rather than merely the
 * setting: pointing at an empty folder and leaving the data behind would look
 * exactly like having lost it.
 */
export function DataFolderCard() {
  const t = useT();
  const [info, setInfo] = useState<DataRootInfo | null>(null);
  const [plan, setPlan] = useState<DataRootPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState(false);

  const refresh = useCallback(async () => {
    const result = await api.settings.getDataRoot();
    if (result.success && result.data) setInfo(result.data);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!info) return null;

  const isDefault = info.path === info.defaultPath;

  /** Show what a choice would do, or say why it could not even be looked at. */
  const consider = async (ask: () => ReturnType<typeof api.settings.chooseDataRoot>) => {
    setError(null);
    const result = await ask();
    if (!result.success) setError(result.error ?? t('dataRoot.failed', { error: '' }));
    else if (result.data) setPlan(result.data);
  };

  const forget = async () => {
    setError(null);
    setForgetting(true);
    const result = await api.settings.forgetDataRoot();
    if (result.success) {
      await api.system.relaunch();
      return;
    }
    setForgetting(false);
    setError(result.error ?? t('dataRoot.failed', { error: '' }));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <HardDrive size={14} className="shrink-0 text-rf-text-muted" aria-hidden="true" />
        <span className="text-sm text-rf-text-secondary">{t('settings.dataFolder')}:</span>
        <code className="select-text break-all rounded bg-rf-bg-tertiary px-1.5 py-0.5 font-mono text-xs text-rf-text">
          {info.path}
        </code>
      </div>

      <p className="text-xs text-rf-text-muted">{t('settings.dataFolderHint')}</p>

      {/* Said about the folder in use, not only about one being chosen: a
          default under a Windows user name with a space or a Polish letter in
          it has the same problem, and moving is the cure for it. */}
      {(info.hasSpaces || info.hasNonAscii) && (
        <p className="flex items-start gap-1.5 text-xs text-rf-warning">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          {t(info.hasNonAscii ? 'dataRoot.warnNonAscii' : 'dataRoot.warnSpaces')}
        </p>
      )}

      {info.unavailable && (
        <div className="space-y-1.5">
          <p className="flex items-start gap-1.5 text-xs text-rf-warning">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            {t('settings.dataFolderUnavailable', { path: info.unavailable })}
          </p>
          {/* The one way out that needs no drive: without it a folder that is
              gone for good left the launcher warning about it at every start
              with no control that could make it stop. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" loading={forgetting} onClick={() => void forget()}>
              {t('settings.dataFolderForget')}
            </Button>
            <span className="text-xs text-rf-text-muted">{t('settings.dataFolderForgetHint')}</span>
          </div>
        </div>
      )}

      {info.source === 'env' ? (
        <p className="text-xs text-rf-text-muted">{t('settings.dataFolderEnv')}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={<FolderOpen size={13} />}
            onClick={() => void consider(() => api.settings.chooseDataRoot())}
          >
            {t('settings.dataFolderChange')}
          </Button>
          {!isDefault && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void consider(() => api.settings.planDataRoot(info.defaultPath))}
            >
              {t('settings.dataFolderRestore')}
            </Button>
          )}
        </div>
      )}

      {error && <p className="select-text text-xs text-rf-danger">{error}</p>}

      {plan && <DataRootDialog from={info.path} plan={plan} onClose={() => setPlan(null)} />}
    </div>
  );
}

function DataRootDialog({
  from,
  plan,
  onClose,
}: {
  from: string;
  plan: DataRootPlan;
  onClose: () => void;
}) {
  const t = useT();
  const dialogRef = useDialogFocus<HTMLDivElement>();
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [moved, setMoved] = useState<DataRootMoveResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null && moved === null;

  useEffect(() => {
    return api.on('progress:data-root', (event) => setProgress(event));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Not once the data has moved: the launcher is then pointing at one
      // folder while everything it has loaded came from another, and the only
      // way forward is the restart.
      if (e.key === 'Escape' && !busy && !moved) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy, moved]);

  // With nothing left to tell the player, the restart follows on its own. With
  // leftovers it waits for them: a list that flashes past is a list unread.
  useEffect(() => {
    if (!moved || moved.leftovers.length > 0) return;
    const timer = setTimeout(() => void api.system.relaunch(), RESTART_DELAY_MS);
    return () => clearTimeout(timer);
  }, [moved]);

  const problemText = (): string => {
    switch (plan.problem) {
      case 'same':
        return t('dataRoot.problem.same');
      case 'nested':
        return t('dataRoot.problem.nested');
      case 'notWritable':
        return t('dataRoot.problem.notWritable');
      case 'notEmpty':
        return t('dataRoot.problem.notEmpty');
      case 'noSpace':
        return t('dataRoot.problem.noSpace', {
          size: formatBytes(plan.bytesToMove),
          free: formatBytes(plan.freeBytes),
        });
      case 'envLocked':
        return t('dataRoot.problem.envLocked');
      case 'gameRunning':
        return t('dataRoot.problem.gameRunning');
      default:
        return '';
    }
  };

  const start = async () => {
    setError(null);
    setProgress({
      operationId: 'data-root',
      progress: 0,
      message: { key: 'progress.msg.movingData' },
    });
    const result = await api.settings.applyDataRoot(plan.target);
    if (result.success && result.data) {
      setMoved(result.data);
      return;
    }
    setProgress(null);
    setError(result.error ?? t('dataRoot.failed', { error: '' }));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      role="presentation"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-rf-border bg-rf-bg-secondary shadow-2xl outline-none"
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="data-root-title"
      >
        <header className="flex items-center gap-2 border-b border-rf-border px-5 py-3">
          <HardDrive size={15} className="shrink-0 text-rf-text-muted" aria-hidden="true" />
          <h2 id="data-root-title" className="flex-1 text-sm font-display font-semibold">
            {t('dataRoot.title')}
          </h2>
          {!busy && !moved && (
            <button
              onClick={onClose}
              aria-label={t('common.close')}
              className="text-rf-text-muted hover:text-rf-text"
            >
              <X size={16} />
            </button>
          )}
        </header>

        <div className="space-y-3 overflow-y-auto px-5 py-4 text-sm text-rf-text-secondary">
          <Row label={t('dataRoot.from')} value={from} />
          <Row label={t('dataRoot.to')} value={plan.target} />

          {plan.problem ? (
            <Warning>{problemText()}</Warning>
          ) : moved ? (
            <>
              <p className="text-sm text-rf-accent-text">{t('dataRoot.done')}</p>
              {moved.leftovers.length > 0 ? (
                <>
                  <Warning>{t('dataRoot.leftovers')}</Warning>
                  <ul className="space-y-1">
                    {moved.leftovers.map((leftover) => (
                      <li key={leftover}>
                        <code className="select-text break-all rounded bg-rf-bg-tertiary px-1.5 py-0.5 font-mono text-xs text-rf-text">
                          {leftover}
                        </code>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-xs text-rf-text-muted">{t('dataRoot.restarting')}</p>
              )}
            </>
          ) : (
            <>
              <p>
                {plan.action === 'adopt'
                  ? t('dataRoot.adopt')
                  : t(plan.sameVolume ? 'dataRoot.moveSameVolume' : 'dataRoot.moveCopy', {
                      size: formatBytes(plan.bytesToMove),
                    })}
              </p>
              {/* What stays behind, said before the move and not found after
                  it. This line used to read "nothing is left in the old place",
                  over a folder that then kept a hundred megabytes. */}
              {plan.action === 'move' && (
                <p className="text-xs text-rf-text-muted">
                  {t(plan.leavesHome ? 'dataRoot.staysHome' : 'dataRoot.staysNothing')}
                </p>
              )}
              {plan.action === 'move' && plan.replacesDebris && (
                <p className="text-xs text-rf-text-muted">{t('dataRoot.replacesDebris')}</p>
              )}
              {plan.freeBytes !== undefined && plan.action === 'move' && !plan.sameVolume && (
                <p className="text-xs text-rf-text-muted">
                  {t('dataRoot.free', { free: formatBytes(plan.freeBytes) })}
                </p>
              )}
              {(plan.hasSpaces || plan.hasNonAscii) && (
                <Warning>
                  {t(plan.hasNonAscii ? 'dataRoot.warnNonAscii' : 'dataRoot.warnSpaces')}
                </Warning>
              )}
              <p className="text-xs text-rf-text-muted">{t('dataRoot.restartNotice')}</p>
            </>
          )}

          {busy && progress && (
            <div className="space-y-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-rf-bg-tertiary">
                <div
                  className="h-full bg-rf-accent transition-[width]"
                  style={{ width: `${Math.round(progress.progress * 100)}%` }}
                />
              </div>
              <p className="truncate text-xs text-rf-text-muted" role="status">
                {t('dataRoot.moving')} {progress.currentFile ?? ''}
              </p>
            </div>
          )}

          {error && <p className="select-text text-xs text-rf-danger">{error}</p>}
        </div>

        {!plan.problem && (
          <footer className="flex justify-end gap-2 border-t border-rf-border px-5 py-3">
            {moved ? (
              <Button size="sm" onClick={() => void api.system.relaunch()}>
                {t('common.restart')}
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
                  {t('common.cancel')}
                </Button>
                <Button size="sm" loading={busy} onClick={() => void start()}>
                  {plan.action === 'adopt' ? t('dataRoot.confirmAdopt') : t('dataRoot.confirm')}
                </Button>
              </>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-rf-warning">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="text-xs text-rf-text-muted">{label}:</span>
      <code className="select-text break-all rounded bg-rf-bg-tertiary px-1.5 py-0.5 font-mono text-xs text-rf-text">
        {value}
      </code>
    </div>
  );
}
