import { useEffect } from 'react';
import { useProgressStore } from '@stores/progress-store';
import { formatBytes } from '@renderer/format';
import { useT, type TFunction, type TranslationKey } from '@renderer/i18n';
import type { ProgressMessage } from '@shared/ipc-types';

const CHANNEL_LABELS: Record<string, TranslationKey> = {
  'progress:mod-sync': 'progress.modSync',
  'progress:mod-download': 'progress.modDownload',
  'progress:loader-install': 'progress.loaderInstall',
  'progress:java-download': 'progress.javaDownload',
  'progress:game-assets': 'progress.gameAssets',
  'progress:launcher-update': 'progress.launcherUpdate',
};

/**
 * Say a progress line in the user's language.
 *
 * The main process names a key; the dictionary supplies the sentence. That
 * split is the whole point — `src/core/` has no locale, and these lines used to
 * be written there in Polish, so an English user watched their install narrate
 * itself in a language they never chose.
 */
function progressText(t: TFunction, message: ProgressMessage): string {
  if ('text' in message) return message.text;
  if ('pluralKey' in message) return t.plural(message.pluralKey, message.count, message.vars);
  return t(message.key, message.vars);
}

export function InstallProgressOverlay() {
  const t = useT();
  const init = useProgressStore((s) => s.init);
  const entries = useProgressStore((s) => s.entries);
  const hasActive = useProgressStore((s) => s.hasActive);

  useEffect(() => {
    init();
  }, [init]);

  if (!hasActive && entries.size === 0) return null;

  const items = [...entries.values()];
  const overall = items.reduce((acc, e) => acc + e.progress, 0) / items.length;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border border-rf-border bg-rf-bg-secondary/95 p-3 shadow-lg backdrop-blur animate-fade-in">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-display font-semibold uppercase tracking-wider text-rf-text-secondary">
          {t('progress.title')}
        </span>
        <ProgressRing progress={overall} />
      </div>

      <div className="space-y-2 max-h-60 overflow-y-auto">
        {items.map((item) => (
          <div key={item.operationId} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-rf-text-secondary">
                {CHANNEL_LABELS[item.channel] ? t(CHANNEL_LABELS[item.channel]) : item.channel}
              </span>
              <span className="shrink-0 text-rf-text-muted">
                {Math.round(item.progress * 100)}%
              </span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-rf-bg-tertiary">
              <div
                className="h-full bg-rf-accent transition-all duration-200"
                style={{ width: `${Math.max(2, item.progress * 100)}%` }}
              />
            </div>
            {(item.currentFile || item.message) && (
              <p className="truncate text-[10px] text-rf-text-muted">
                {item.currentFile ?? progressText(t, item.message)}
                {item.bytesTotal !== undefined && (
                  <>
                    {' '}
                    • {formatBytes(item.bytesDownloaded)} / {formatBytes(item.bytesTotal)}
                  </>
                )}
                {item.filesTotal !== undefined && (
                  <>
                    {' '}
                    •{' '}
                    {t.plural('progress.files', item.filesTotal, {
                      done: item.filesCompleted ?? 0,
                      total: item.filesTotal,
                    })}
                  </>
                )}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ProgressRing({ progress }: { progress: number }) {
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(1, progress)));

  return (
    <svg width="28" height="28" viewBox="0 0 28 28" className="shrink-0">
      <circle
        cx="14"
        cy="14"
        r={radius}
        fill="none"
        stroke="var(--rf-bg-tertiary)"
        strokeWidth="3"
      />
      <circle
        cx="14"
        cy="14"
        r={radius}
        fill="none"
        stroke="var(--rf-accent)"
        strokeWidth="3"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 14 14)"
        className="transition-all duration-200"
      />
    </svg>
  );
}
