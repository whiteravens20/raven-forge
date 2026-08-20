import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, FolderOpen, HardDrive, X } from 'lucide-react';
import { Button } from '@components/ui/Button';
import { useT } from '@renderer/i18n';
import { formatBytes } from '@renderer/format';
import type { DataRootInfo, DataRootPlan, ProgressEvent } from '@shared/ipc-types';

const api = window.ravenforge;

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

  const refresh = useCallback(async () => {
    const result = await api.settings.getDataRoot();
    if (result.success && result.data) setInfo(result.data);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!info) return null;

  const isDefault = info.path === info.defaultPath;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <HardDrive size={14} className="shrink-0 text-rf-text-muted" aria-hidden="true" />
        <span className="text-sm text-rf-text-secondary">{t('settings.dataFolder')}:</span>
        <code className="rounded bg-rf-bg-tertiary px-1.5 py-0.5 font-mono text-xs text-rf-text">
          {info.path}
        </code>
        <button
          onClick={() => void api.system.openPath(info.path)}
          className="text-sm text-rf-accent-text hover:underline"
        >
          {t('common.openFolder')}
        </button>
      </div>

      <p className="text-xs text-rf-text-muted">{t('settings.dataFolderHint')}</p>

      {info.unavailable && (
        <p className="flex items-start gap-1.5 text-xs text-rf-warning">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          {t('settings.dataFolderUnavailable', { path: info.unavailable })}
        </p>
      )}

      {info.source === 'env' ? (
        <p className="text-xs text-rf-text-muted">{t('settings.dataFolderEnv')}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={<FolderOpen size={13} />}
            onClick={async () => {
              const result = await api.settings.chooseDataRoot();
              if (result.success && result.data) setPlan(result.data);
            }}
          >
            {t('settings.dataFolderChange')}
          </Button>
          {!isDefault && (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                const result = await api.settings.planDataRoot(info.defaultPath);
                if (result.success && result.data) setPlan(result.data);
              }}
            >
              {t('settings.dataFolderRestore')}
            </Button>
          )}
        </div>
      )}

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
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null || restarting;

  useEffect(() => {
    return api.on('progress:data-root', (event) => setProgress(event));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const problemText = (): string => {
    switch (plan.problem) {
      case 'same':
        return t('dataRoot.problem.same');
      case 'nested':
        return t('dataRoot.problem.nested');
      case 'notWritable':
        return t('dataRoot.problem.notWritable');
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
    if (result.success) {
      setRestarting(true);
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
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-rf-border bg-rf-bg-secondary shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="data-root-title"
      >
        <header className="flex items-center gap-2 border-b border-rf-border px-5 py-3">
          <HardDrive size={15} className="shrink-0 text-rf-text-muted" aria-hidden="true" />
          <h2 id="data-root-title" className="flex-1 text-sm font-display font-semibold">
            {t('dataRoot.title')}
          </h2>
          {!busy && (
            <button
              onClick={onClose}
              aria-label={t('common.close')}
              className="text-rf-text-muted hover:text-rf-text"
            >
              <X size={16} />
            </button>
          )}
        </header>

        <div className="space-y-3 px-5 py-4 text-sm text-rf-text-secondary">
          <Row label={t('dataRoot.from')} value={from} />
          <Row label={t('dataRoot.to')} value={plan.target} />

          {plan.problem ? (
            <p className="flex items-start gap-1.5 text-sm text-rf-warning">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              {problemText()}
            </p>
          ) : (
            <>
              <p>
                {plan.action === 'adopt'
                  ? t('dataRoot.adopt')
                  : t('dataRoot.move', { size: formatBytes(plan.bytesToMove) })}
              </p>
              {plan.freeBytes !== undefined && plan.action === 'move' && (
                <p className="text-xs text-rf-text-muted">
                  {t('dataRoot.free', { free: formatBytes(plan.freeBytes) })}
                </p>
              )}
              <p className="text-xs text-rf-text-muted">{t('dataRoot.restartNotice')}</p>
            </>
          )}

          {progress && !restarting && (
            <div className="space-y-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-rf-bg-tertiary">
                <div
                  className="h-full bg-rf-accent transition-[width]"
                  style={{ width: `${Math.round(progress.progress * 100)}%` }}
                />
              </div>
              <p className="truncate text-xs text-rf-text-muted">
                {t('dataRoot.moving')} {progress.currentFile ?? ''}
              </p>
            </div>
          )}

          {restarting && <p className="text-sm text-rf-accent-text">{t('dataRoot.restarting')}</p>}
          {error && <p className="text-xs text-rf-danger">{t('dataRoot.failed', { error })}</p>}
        </div>

        {!plan.problem && !restarting && (
          <footer className="flex justify-end gap-2 border-t border-rf-border px-5 py-3">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" loading={busy} onClick={() => void start()}>
              {plan.action === 'adopt' ? t('dataRoot.confirmAdopt') : t('dataRoot.confirm')}
            </Button>
          </footer>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="text-xs text-rf-text-muted">{label}:</span>
      <code className="break-all rounded bg-rf-bg-tertiary px-1.5 py-0.5 font-mono text-xs text-rf-text">
        {value}
      </code>
    </div>
  );
}
