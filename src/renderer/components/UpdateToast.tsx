// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { Download, RotateCw, X } from 'lucide-react';
import { Button } from '@components/ui/Button';
import { useUpdaterStore } from '@stores/updater-store';
import { releaseNotesUrl } from '@shared/branding';
import { openLink } from '@renderer/open';
import { useT } from '@renderer/i18n';

/**
 * Non-blocking launcher-update prompt.
 *
 * Every transition is the user's call: restarting mid-download or mid-session
 * is the single most annoying thing a launcher can do. "Later" puts the update
 * off for this session — here and on the Play button alike — and the next start
 * offers it again.
 */
export function UpdateToast() {
  const t = useT();
  const info = useUpdaterStore((s) => s.available);
  const stage = useUpdaterStore((s) => s.stage);
  const percent = useUpdaterStore((s) => s.percent);
  const error = useUpdaterStore((s) => s.error);
  const postponed = useUpdaterStore((s) => s.postponed);
  const download = useUpdaterStore((s) => s.download);
  const install = useUpdaterStore((s) => s.install);
  const postpone = useUpdaterStore((s) => s.postpone);

  if (!info || postponed) return null;

  const ready = stage === 'ready';
  const downloading = stage === 'downloading';

  return (
    <div
      className="fixed bottom-4 right-4 z-40 w-80 rounded-lg border border-rf-border bg-rf-bg-secondary/95 p-3 shadow-xl backdrop-blur"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <p className="text-sm font-medium text-rf-text">
            {ready ? t('update.ready') : t('update.available', { version: info.version })}
          </p>
          <p className="mt-0.5 text-xs text-rf-text-muted">
            {ready ? t('update.willInstall', { version: info.version }) : t('update.pending')}
          </p>
          {/* What it brings, before it is taken: the release's own notes. */}
          <button
            onClick={() => void openLink(releaseNotesUrl(info.version))}
            className="mt-1 text-xs text-rf-accent-text underline-offset-2 hover:underline"
          >
            {t('update.whatsNew')}
          </button>
        </div>

        <button
          onClick={postpone}
          className="shrink-0 text-rf-text-muted transition-colors hover:text-rf-text"
          aria-label={t('update.hide')}
        >
          <X size={13} />
        </button>
      </div>

      {downloading && (
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

      {(stage === 'failed' || error) && (
        <p className="mt-2 select-text text-[11px] text-rf-danger">
          {ready ? t('update.installFailed') : t('update.downloadFailed')}
          {error ? `: ${error}` : ''}
        </p>
      )}

      {!downloading && (
        <div className="mt-2.5 flex gap-2">
          {ready ? (
            <Button
              variant="primary"
              size="sm"
              icon={<RotateCw size={13} />}
              onClick={() => void install()}
            >
              {t('common.restart')}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              icon={<Download size={13} />}
              onClick={() => void download()}
            >
              {t('common.download')}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={postpone}>
            {t('common.later')}
          </Button>
        </div>
      )}
    </div>
  );
}
