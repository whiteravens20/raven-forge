import { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { Button } from '@components/ui/Button';
import { useT } from '@renderer/i18n';
import type { ShaderLoaderOption } from '@shared/ipc-types';

interface Props {
  options: ShaderLoaderOption[];
  busy: boolean;
  onInstall: (projectId: string) => void;
  onSkip: () => void;
}

/**
 * Asks which shader loader to install, the first time a profile gets a shader.
 *
 * It asks rather than decides. On NeoForge both Iris and Oculus can run, they
 * pull in different rendering mods (Sodium against Embeddium), and which of
 * those a player already has opinions about is not something a launcher can
 * work out. Where only one option exists this is still shown, because the
 * honest alternative — quietly adding two mods nobody asked for — is worse.
 */
export function ShaderLoaderPicker({ options, busy, onInstall, onSkip }: Props) {
  const t = useT();
  const [picked, setPicked] = useState(
    () => (options.find((o) => o.recommended) ?? options[0])?.id ?? '',
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onSkip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSkip, busy]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      role="presentation"
    >
      <div
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-rf-border bg-rf-bg-secondary shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={t('shaderLoader.title')}
      >
        <header className="flex items-center gap-2 border-b border-rf-border px-5 py-3">
          <Sparkles size={15} className="shrink-0 text-rf-accent-text" />
          <h2
            id="shader-loader-title"
            className="flex-1 text-sm font-display font-semibold text-rf-text"
          >
            {t('shaderLoader.title')}
          </h2>
          <button
            onClick={onSkip}
            disabled={busy}
            aria-label={t('common.close')}
            className="text-rf-text-muted hover:text-rf-text disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </header>

        <div className="space-y-3 px-5 py-4">
          <p className="text-sm text-rf-text-secondary">{t('shaderLoader.why')}</p>

          {/* Labelled by the heading rather than a duplicate legend — a screen
              reader announcing the same question twice is noise, not clarity. */}
          <fieldset className="space-y-2" aria-labelledby="shader-loader-title">
            {options.map((option) => (
              <label
                key={option.id}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                  picked === option.id
                    ? 'border-rf-accent bg-rf-accent/10'
                    : 'border-rf-border hover:border-rf-accent/50'
                }`}
              >
                <input
                  type="radio"
                  name="shader-loader"
                  value={option.id}
                  checked={picked === option.id}
                  onChange={() => setPicked(option.id)}
                  className="mt-0.5 accent-rf-accent"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-rf-text">
                    {option.name}{' '}
                    <span className="font-normal text-rf-text-muted">{option.version}</span>
                  </span>
                  {option.dependencies.length > 0 && (
                    <span className="mt-0.5 block text-xs text-rf-text-muted">
                      {t('shaderLoader.alsoInstalls', { deps: option.dependencies.join(', ') })}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
        </div>

        <footer className="flex justify-end gap-2 border-t border-rf-border px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onSkip} disabled={busy}>
            {t('shaderLoader.skip')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            disabled={!picked}
            onClick={() => onInstall(picked)}
          >
            {t('common.install')}
          </Button>
        </footer>
      </div>
    </div>
  );
}
