import { useState } from 'react';
import { AlertTriangle, X, FileText } from 'lucide-react';
import { Button } from '@components/ui/Button';
import { useT } from '@renderer/i18n';
import type { GameExitInfo } from '@shared/ipc-types';

interface CrashReporterProps {
  crashInfo: GameExitInfo;
  profileName: string;
  onDismiss: () => void;
}

export function CrashReporter({ crashInfo, profileName, onDismiss }: CrashReporterProps) {
  const t = useT();
  const [showLogs, setShowLogs] = useState(false);

  return (
    <div
      className="rounded-lg border border-rf-danger/40 bg-rf-danger/10 p-4 space-y-3"
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle size={18} className="shrink-0 text-rf-danger" />
          <div>
            <h3 className="text-sm font-semibold text-rf-danger">{t('crash.title')}</h3>
            <p className="text-xs text-rf-text-secondary">
              {crashInfo.playTimeMinutes > 0
                ? t('crash.bodyWithTime', {
                    profile: profileName,
                    code: crashInfo.exitCode ?? '?',
                    minutes: crashInfo.playTimeMinutes,
                  })
                : t('crash.body', { profile: profileName, code: crashInfo.exitCode ?? '?' })}
            </p>
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="shrink-0 text-rf-text-muted hover:text-rf-text transition-colors"
          aria-label={t('common.close')}
        >
          <X size={14} />
        </button>
      </div>

      {crashInfo.logTail && crashInfo.logTail.length > 0 && (
        <div>
          <Button
            variant="secondary"
            size="sm"
            icon={<FileText size={12} />}
            onClick={() => setShowLogs((v) => !v)}
          >
            {showLogs ? t('crash.hideLogs') : t('crash.showLogs')}
          </Button>

          {showLogs && (
            <pre className="mt-2 max-h-48 overflow-y-auto rounded border border-rf-border bg-rf-bg p-2 font-mono text-[10px] text-rf-text-secondary">
              {crashInfo.logTail.join('\n')}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
