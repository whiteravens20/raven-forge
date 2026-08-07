import { useState, useEffect } from 'react';
import { Minus, Square, X, Copy } from 'lucide-react';
import iconMono from '@assets/icons/icon-mono.svg?raw';
import { InlineSvg } from '@components/ui/InlineSvg';
import { useT } from '@renderer/i18n';

const api = window.ravenforge;

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const t = useT();

  useEffect(() => {
    const handler = (isMax: boolean) => setMaximized(isMax);
    const stop = api.on('window:maximized-changed', handler);
    api.window.isMaximized().then(setMaximized);
    return stop;
  }, []);

  return (
    <header className="drag-region flex h-9 items-center justify-between bg-rf-bg-secondary border-b border-rf-border select-none shrink-0">
      <div className="flex items-center gap-2 px-3">
        <InlineSvg markup={iconMono} className="h-4 w-4 text-rf-accent" />
        <span className="text-sm font-display font-semibold text-rf-accent tracking-wide">
          RAVEN FORGE
        </span>
      </div>

      <div className="no-drag flex h-full">
        <button
          onClick={() => api.window.minimize()}
          className="flex h-full w-11 items-center justify-center text-rf-text-secondary hover:bg-rf-surface transition-colors"
          aria-label={t('window.minimize')}
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => api.window.maximize()}
          className="flex h-full w-11 items-center justify-center text-rf-text-secondary hover:bg-rf-surface transition-colors"
          aria-label={maximized ? t('window.restore') : t('window.maximize')}
        >
          {maximized ? <Copy size={12} /> : <Square size={12} />}
        </button>
        <button
          onClick={() => api.window.close()}
          className="flex h-full w-11 items-center justify-center text-rf-text-secondary hover:bg-rf-danger hover:text-white transition-colors"
          aria-label={t('window.close')}
        >
          <X size={14} />
        </button>
      </div>
    </header>
  );
}
