import { useEffect, useRef, useState } from 'react';
import { Terminal, X } from 'lucide-react';
import { useSettingsStore } from '@stores/settings-store';
import { useLocale, useT } from '@renderer/i18n';
import type { GameLogLine } from '@shared/ipc-types';

const api = window.ravenforge;

interface LiveConsoleProps {
  profileId: string;
  onClose: () => void;
}

export function LiveConsole({ profileId, onClose }: LiveConsoleProps) {
  const settings = useSettingsStore((s) => s.settings);
  const t = useT();
  const locale = useLocale();
  const [lines, setLines] = useState<GameLogLine[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  const isLive = settings?.showLiveConsole ?? false;

  // Seed from main's ring buffer: the console is usually opened well after the
  // game started, and without this it sits empty until the next line arrives.
  useEffect(() => {
    if (!isLive) return;
    let cancelled = false;
    void api.game.getLogTail(profileId).then((result) => {
      if (cancelled || !result.success || !result.data) return;
      const buffered = result.data;
      setLines((prev) =>
        prev.length > 0
          ? prev
          : buffered.map((message) => ({
              timestamp: new Date().toISOString(),
              level: 'info' as const,
              message,
            })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [profileId, isLive]);

  useEffect(() => {
    if (!isLive) return;

    const handleLog = (_pid: string, line: GameLogLine) => {
      if (_pid !== profileId) return;
      setLines((prev) => {
        const next = [...prev, line];
        if (next.length > 200) next.shift();
        return next;
      });
    };

    api.on('game:log', handleLog);
    return () => api.off('game:log', handleLog);
  }, [profileId, isLive]);

  // Auto-scroll to bottom
  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    autoScroll.current = scrollTop + clientHeight >= scrollHeight - 10;
  };

  useEffect(() => {
    if (autoScroll.current && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [lines]);

  if (!isLive) return null;

  return (
    <div
      className="flex flex-col rounded-lg border border-rf-border bg-rf-bg-secondary/95 text-rf-text shadow-lg backdrop-blur"
      style={{ height: 180 }}
      role="region"
      aria-label={t('console.title')}
    >
      <div className="flex items-center justify-between border-b border-rf-border px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-xs font-medium text-rf-text-secondary">
          <Terminal size={12} />
          {t('console.title')}
        </span>
        <button
          onClick={onClose}
          className="text-rf-text-muted hover:text-rf-text transition-colors"
          aria-label={t('console.close')}
        >
          <X size={12} />
        </button>
      </div>

      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed"
        onScroll={handleScroll}
      >
        {lines.length === 0 && <p className="text-rf-text-muted">{t('console.waiting')}</p>}
        {lines.map((line, idx) => (
          <div
            key={idx}
            className={`break-all ${
              line.level === 'error'
                ? 'text-rf-danger'
                : line.level === 'warn'
                  ? 'text-rf-warning'
                  : 'text-rf-text-secondary'
            }`}
          >
            <span className="text-rf-text-muted mr-2">
              {new Date(line.timestamp).toLocaleTimeString(locale)}
            </span>
            {line.message}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
