import { useEffect, useState } from 'react';
import { Download, RotateCw, X } from 'lucide-react';
import { Button } from '@components/ui/Button';
import { useT } from '@renderer/i18n';
import type { ProgressEvent, UpdateInfo } from '@shared/ipc-types';

const api = window.ravenforge;

type Stage = 'available' | 'downloading' | 'downloaded';

function formatSize(bytes?: number): string | null {
  if (!bytes) return null;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Non-blocking launcher-update prompt.
 *
 * Deliberately never auto-installs: restarting mid-download or mid-session is
 * the single most annoying thing a launcher can do, so every transition is the
 * user's call. Dismissing hides the toast for this session only — the next
 * start surfaces it again if the update is still pending.
 */
export function UpdateToast() {
  const t = useT();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [stage, setStage] = useState<Stage>('available');
  const [percent, setPercent] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onAvailable = (update: UpdateInfo) => {
      setInfo(update);
      setStage('available');
      setDismissed(false);
    };

    const onDownloaded = (update: UpdateInfo) => {
      setInfo(update);
      setStage('downloaded');
      setDismissed(false);
    };

    const onProgress = (event: ProgressEvent) => {
      setPercent(Math.round(event.progress * 100));
    };

    api.on('updater:update-available', onAvailable);
    api.on('updater:update-downloaded', onDownloaded);
    api.on('progress:launcher-update', onProgress);
    return () => {
      api.off('updater:update-available', onAvailable);
      api.off('updater:update-downloaded', onDownloaded);
      api.off('progress:launcher-update', onProgress);
    };
  }, []);

  if (!info || dismissed) return null;

  const handleDownload = async () => {
    setStage('downloading');
    setError(null);
    const result = await api.updater.download();
    if (!result.success) {
      setError(result.error ?? t('update.downloadFailed'));
      setStage('available');
    }
  };

  const handleInstall = async () => {
    const result = await api.updater.install();
    // Success quits the app, so only a failure ever gets here.
    if (!result.success) {
      setError(result.error ?? t('update.installFailed'));
    }
  };

  const size = formatSize(info.downloadSize);

  return (
    <div
      className="fixed bottom-4 right-4 z-40 w-80 rounded-lg border border-rf-border bg-rf-bg-secondary/95 p-3 shadow-xl backdrop-blur"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <p className="text-sm font-medium text-rf-text">
            {stage === 'downloaded'
              ? t('update.ready')
              : t('update.available', { version: info.version })}
          </p>
          <p className="mt-0.5 text-xs text-rf-text-muted">
            {stage === 'downloaded'
              ? t('update.willInstall', { version: info.version })
              : (size ?? t('update.pending'))}
          </p>
        </div>

        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 text-rf-text-muted transition-colors hover:text-rf-text"
          aria-label={t('update.hide')}
        >
          <X size={13} />
        </button>
      </div>

      {stage === 'downloading' && (
        <div className="mt-2.5">
          <div className="h-1 overflow-hidden rounded-full bg-rf-bg-tertiary">
            <div
              className="h-full bg-rf-accent transition-[width] duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-rf-text-muted">
            {t('update.downloading', { percent })}
          </p>
        </div>
      )}

      {error && <p className="mt-2 text-[11px] text-rf-danger">{error}</p>}

      {stage !== 'downloading' && (
        <div className="mt-2.5 flex gap-2">
          {stage === 'downloaded' ? (
            <Button
              variant="primary"
              size="sm"
              icon={<RotateCw size={13} />}
              onClick={() => void handleInstall()}
            >
              {t('common.restart')}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              icon={<Download size={13} />}
              onClick={() => void handleDownload()}
            >
              {t('common.download')}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
            {t('common.later')}
          </Button>
        </div>
      )}
    </div>
  );
}
