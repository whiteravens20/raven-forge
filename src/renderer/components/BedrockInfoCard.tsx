import { useState } from 'react';
import { ExternalLink, Info, X } from 'lucide-react';
import { Button } from '@components/ui/Button';
import { useT } from '@renderer/i18n';

const api = window.ravenforge;

const DISMISS_KEY = 'rf-bedrock-card-dismissed';
const BEDROCK_URL = 'https://www.minecraft.net/en-us/download';

/**
 * Raven Forge is a Java Edition launcher and will stay one — Bedrock ships as a
 * closed Microsoft Store package with no third-party launch path. This card
 * exists purely so someone who bought the Java & Bedrock bundle stops hunting
 * for a Bedrock button that is never going to be here.
 *
 * It is the *only* place Bedrock is mentioned in the codebase. Keep it that way.
 */
export function BedrockInfoCard() {
  const t = useT();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1');

  if (dismissed) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  return (
    <div className="w-full max-w-md rounded-lg border border-rf-border bg-rf-surface/60 p-4">
      <div className="flex items-start gap-2.5">
        <Info size={15} className="mt-0.5 shrink-0 text-rf-text-muted" />
        <div className="flex-1">
          <h2 className="text-sm font-medium text-rf-text">{t('bedrock.title')}</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-rf-text-secondary">
            {t('bedrock.body')}
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-rf-text-muted">{t('bedrock.bundle')}</p>

          <Button
            variant="ghost"
            size="sm"
            icon={<ExternalLink size={12} />}
            className="mt-2.5"
            onClick={() => void api.system.openUrl(BEDROCK_URL)}
          >
            {t('bedrock.open')}
          </Button>
        </div>

        <button
          onClick={dismiss}
          className="shrink-0 text-rf-text-muted transition-colors hover:text-rf-text"
          aria-label={t('bedrock.dismiss')}
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
