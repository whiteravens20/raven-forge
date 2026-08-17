import { useEffect, Fragment } from 'react';
import { X, ExternalLink } from 'lucide-react';
import { parseArticle, type Block, type Span } from '@shared/article';
import { useT } from '@renderer/i18n';

const api = window.ravenforge;

export interface Article {
  title: string;
  /** Shown under the title — a date for news, the banner text for announcements. */
  subtitle?: string;
  body?: string;
  /** Fallback text when the feed carries no `body`. */
  excerpt?: string;
  url?: string;
}

/**
 * Reads a news item or announcement inside the launcher.
 *
 * Clicking either used to hand the URL to the system browser, which assumes
 * there is a website on the other end. There is not — the feeds are JSON on
 * Pages — so the launcher renders the text itself and `url` becomes an optional
 * way out rather than the only way in.
 */
export function ArticleReader({ article, onClose }: { article: Article; onClose: () => void }) {
  const t = useT();

  // Escape closes it. A modal that can only be dismissed by hitting a specific
  // 16px target is a modal a keyboard user is stuck in.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const blocks = article.body ? parseArticle(article.body) : parseArticle(article.excerpt ?? '');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-rf-border bg-rf-bg-secondary shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={article.title}
      >
        <header className="flex items-start gap-3 border-b border-rf-border px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-display font-semibold text-rf-text">{article.title}</h2>
            {article.subtitle && (
              <p className="mt-0.5 text-xs text-rf-text-muted">{article.subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="shrink-0 text-rf-text-muted hover:text-rf-text"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4 text-sm text-rf-text-secondary">
          {blocks.length === 0 ? (
            <p className="text-rf-text-muted">{t('news.noBody')}</p>
          ) : (
            blocks.map((block, i) => <BlockView key={i} block={block} />)
          )}
        </div>

        {article.url && (
          <footer className="border-t border-rf-border px-5 py-2.5">
            <button
              onClick={() => void api.system.openUrl(article.url!)}
              className="inline-flex items-center gap-1.5 text-xs text-rf-accent-text hover:underline"
            >
              <ExternalLink size={13} />
              {t('news.openInBrowser')}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case 'heading':
      return (
        <h3 className="pt-1 text-sm font-display font-semibold text-rf-text">
          <Spans spans={block.spans} />
        </h3>
      );
    case 'list':
      return (
        <ul className="list-disc space-y-1 pl-5">
          {block.items.map((item, i) => (
            <li key={i}>
              <Spans spans={item} />
            </li>
          ))}
        </ul>
      );
    case 'paragraph':
      return (
        <p className="leading-relaxed">
          <Spans spans={block.spans} />
        </p>
      );
  }
}

function Spans({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((span, i) => (
        <Fragment key={i}>
          <SpanView span={span} />
        </Fragment>
      ))}
    </>
  );
}

function SpanView({ span }: { span: Span }) {
  switch (span.kind) {
    case 'bold':
      return <strong className="font-semibold text-rf-text">{span.text}</strong>;
    case 'italic':
      return <em>{span.text}</em>;
    case 'code':
      return (
        <code className="rounded bg-rf-bg-tertiary px-1 py-0.5 font-mono text-xs text-rf-text">
          {span.text}
        </code>
      );
    case 'link':
      return (
        <button
          onClick={() => void api.system.openUrl(span.href)}
          className="text-rf-accent-text hover:underline"
        >
          {span.text}
        </button>
      );
    case 'text':
      return <>{span.text}</>;
  }
}
