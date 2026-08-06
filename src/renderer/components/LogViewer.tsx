import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardCheck, Copy, FileText, FolderOpen, RefreshCw, X } from 'lucide-react';
import { Button } from '@components/ui/Button';
import { useT } from '@renderer/i18n';

const api = window.ravenforge;

/** How often the tail re-reads while the viewer is open. */
const POLL_MS = 2000;

/** Matches the main process's own cap; a longer scrollback is not readable anyway. */
const MAX_LINES = 5000;

type LevelFilter = 'all' | 'warn' | 'error';

/**
 * electron-log writes `[2026-08-02 12:00:00.000] [info] message`. Parsing the
 * level out lets us colour and filter; anything unparseable (stack-trace
 * continuation lines, mostly) is kept and shown as plain text.
 */
const LINE_RE = /^\[(?<time>[^\]]+)\]\s*\[(?<level>\w+)\]\s*(?<message>.*)$/s;

interface ParsedLine {
  time?: string;
  level?: string;
  message: string;
  raw: string;
}

function parseLine(raw: string): ParsedLine {
  const m = LINE_RE.exec(raw);
  if (!m?.groups) return { message: raw, raw };
  return {
    time: m.groups.time,
    level: m.groups.level.toLowerCase(),
    message: m.groups.message,
    raw,
  };
}

function levelClass(level?: string): string {
  switch (level) {
    case 'error':
      return 'text-rf-danger';
    case 'warn':
      return 'text-rf-warning';
    case 'debug':
    case 'verbose':
      return 'text-rf-text-muted';
    default:
      return 'text-rf-text-secondary';
  }
}

interface LogViewerProps {
  onClose: () => void;
}

export function LogViewer({ onClose }: LogViewerProps) {
  const t = useT();
  const [lines, setLines] = useState<ParsedLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<LevelFilter>('all');
  const [copied, setCopied] = useState(false);
  const [follow, setFollow] = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  /**
   * Where the last read stopped, so the next one asks only for what came after.
   *
   * Kept in a ref rather than in state: it must not itself cause a render, and
   * the poll has to see the value from the read immediately before it.
   */
  const cursor = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    const result = await api.system.readLog(undefined, cursor.current);
    if (!result.success || !result.data) {
      setError(result.error ?? t('logs.readFailed'));
      setLoading(false);
      return;
    }

    const { lines: incoming, size, reset } = result.data;
    cursor.current = size;
    setError(null);
    setLoading(false);

    // Nothing new is the ordinary case for an idle launcher, and re-rendering a
    // five-thousand-row list to show the same five thousand rows is the reason
    // this poll used to cost anything at all.
    if (!reset && incoming.length === 0) return;

    const parsed = incoming.map(parseLine);
    setLines((previous) => (reset ? parsed : [...previous, ...parsed].slice(-MAX_LINES)));
  }, [t]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Esc closes, matching every other dismissible surface in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const visible = useMemo(() => {
    if (filter === 'all') return lines;
    if (filter === 'error') return lines.filter((l) => l.level === 'error');
    return lines.filter((l) => l.level === 'error' || l.level === 'warn');
  }, [lines, filter]);

  // Only chase the bottom while the user is already there — scrolling up to
  // read something must not be yanked away by the next poll.
  useEffect(() => {
    if (follow) bottomRef.current?.scrollIntoView();
  }, [visible, follow]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    setFollow(el.scrollTop + el.clientHeight >= el.scrollHeight - 24);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(visible.map((l) => l.raw).join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenFolder = async () => {
    const result = await api.system.getLogsPath();
    if (result.success && result.data) await api.system.openPath(result.data);
  };

  const counts = useMemo(
    () => ({
      error: lines.filter((l) => l.level === 'error').length,
      warn: lines.filter((l) => l.level === 'warn').length,
    }),
    [lines],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-rf-border bg-rf-bg-secondary shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('logs.title')}
      >
        <header className="flex items-center gap-3 border-b border-rf-border px-4 py-2.5">
          <FileText size={15} className="text-rf-accent shrink-0" />
          <h2 className="text-sm font-medium text-rf-text">{t('logs.title')}</h2>

          <div className="ml-2 flex gap-3 text-[11px] text-rf-text-muted">
            {counts.error > 0 && (
              <span className="text-rf-danger">{t.plural('logs.errorCount', counts.error)}</span>
            )}
            {counts.warn > 0 && (
              <span className="text-rf-warning">{t.plural('logs.warnCount', counts.warn)}</span>
            )}
          </div>

          <div className="ml-auto flex items-center gap-1">
            {(['all', 'warn', 'error'] as const).map((level) => (
              <button
                key={level}
                onClick={() => setFilter(level)}
                className={`rounded px-2 py-1 text-[11px] transition-colors ${
                  filter === level
                    ? 'bg-rf-accent/15 text-rf-accent'
                    : 'text-rf-text-muted hover:text-rf-text-secondary'
                }`}
              >
                {level === 'all'
                  ? t('logs.filterAll')
                  : level === 'warn'
                    ? t('logs.filterWarn')
                    : t('logs.filterError')}
              </button>
            ))}

            <button
              onClick={() => void refresh()}
              className="ml-1 rounded p-1.5 text-rf-text-muted transition-colors hover:text-rf-text"
              aria-label={t('common.refresh')}
            >
              <RefreshCw size={13} />
            </button>
            <button
              onClick={onClose}
              className="rounded p-1.5 text-rf-text-muted transition-colors hover:text-rf-text"
              aria-label={t('common.close')}
            >
              <X size={14} />
            </button>
          </div>
        </header>

        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto bg-rf-bg px-4 py-3 font-mono text-[11px] leading-relaxed"
        >
          {loading && <p className="text-rf-text-muted">{t('logs.loading')}</p>}
          {error && <p className="text-rf-danger">{error}</p>}
          {!loading && !error && visible.length === 0 && (
            <p className="text-rf-text-muted">
              {lines.length === 0 ? t('logs.empty') : t('logs.noMatches')}
            </p>
          )}

          {visible.map((line, idx) => (
            <div key={idx} className={`whitespace-pre-wrap break-all ${levelClass(line.level)}`}>
              {line.time && <span className="mr-2 text-rf-text-muted">{line.time}</span>}
              {line.message}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <footer className="flex items-center gap-2 border-t border-rf-border px-4 py-2">
          <span className="text-[11px] text-rf-text-muted">
            {t('logs.shown', { visible: visible.length, total: lines.length })}
            {!follow && ` ${t('logs.paused')}`}
          </span>
          <div className="ml-auto flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              icon={copied ? <ClipboardCheck size={13} /> : <Copy size={13} />}
              onClick={() => void handleCopy()}
              disabled={visible.length === 0}
            >
              {copied ? t('common.copied') : t('common.copy')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<FolderOpen size={13} />}
              onClick={() => void handleOpenFolder()}
            >
              {t('common.openFolder')}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
