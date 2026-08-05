import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import iconMono from '@assets/icons/icon-mono.svg?raw';
import { InlineSvg } from '@components/ui/InlineSvg';
import { useLocale, useT } from '@renderer/i18n';
import { useRichT } from '@renderer/i18n/rich';

interface ForgeChronicleProps {
  onClose: () => void;
}

/**
 * The About page easter egg: a found scroll telling the launcher's in-world
 * origin story. Reached only by clicking the raven's eye on the About page —
 * which is also where the story lands, so the reward matches the trigger.
 *
 * The parchment deliberately ignores the theme and carries its own palette in
 * all three, exactly like `assets/brand/logo.svg`: it reads as an object that
 * was found, not as a panel of this app's UI. Styling lives in `global.css`
 * under `rf-chronicle-*`.
 *
 * The text is original prose written for this project — it evokes high-fantasy
 * forging and machine-cult reverence without lifting names or lines from
 * either genre's source material. It lives in the i18n dictionaries like every
 * other string; `useRichT()` exists for the two emphasised phrases in it.
 */
export function ForgeChronicle({ onClose }: ForgeChronicleProps) {
  const t = useT();
  const rich = useRichT();
  const locale = useLocale();
  const dialogRef = useRef<HTMLElement>(null);

  // Esc closes, matching every other dismissible surface in the app. Focus
  // moves to the dialog itself rather than the close button: screen readers
  // still announce it and tabbing starts inside, but no control lights up
  // with a browser focus ring the moment the scroll unrolls.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      onClick={onClose}
      role="presentation"
    >
      <div className="rf-chronicle-veil absolute inset-0 bg-black/70 backdrop-blur-sm" />

      <article
        ref={dialogRef}
        tabIndex={-1}
        className="rf-chronicle-scroll relative flex max-h-full w-full max-w-xl flex-col outline-none"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rf-chronicle-title"
      >
        <div className="rf-chronicle-rod" aria-hidden />

        {/* `min-h-0` + `flex-1` on the body is what makes the sheet scroll
            instead of being clipped by the page's `overflow: hidden` once the
            text is taller than the window. */}
        <div className="rf-chronicle-page relative flex min-h-0 flex-col">
          <div className="rf-chronicle-grain" aria-hidden />
          <div className="rf-chronicle-glow" aria-hidden />

          <button
            onClick={onClose}
            className="rf-chronicle-close"
            aria-label={t('chronicle.close')}
          >
            <X size={15} />
          </button>

          <div className="rf-chronicle-body min-h-0 flex-1 overflow-y-auto px-9 py-8">
            <header className="text-center">
              <InlineSvg markup={iconMono} className="mx-auto h-14 text-[#5c3a12] opacity-75" />
              <h2 id="rf-chronicle-title" className="rf-chronicle-title mt-3">
                {t('chronicle.title')}
              </h2>
              <p className="rf-chronicle-sub">
                {t('chronicle.subtitle')}
                <br />
                {t('chronicle.subtitle2')}
              </p>
              <div className="rf-chronicle-rule" aria-hidden />
            </header>

            {/* The document is `lang="en"`, so justified text would hyphenate
                by English rules (or not at all) without this — and the right
                rules depend on which language the prose is actually in. */}
            <div className="rf-chronicle-text" lang={locale}>
              <p className="rf-chronicle-lede">{rich('chronicle.p1')}</p>
              <p>{rich('chronicle.p2')}</p>
              <p>{rich('chronicle.p3')}</p>
              <p>{rich('chronicle.p4')}</p>
              <p>{rich('chronicle.p5')}</p>
              <p>{rich('chronicle.p6')}</p>
            </div>

            <footer className="mt-7 flex flex-col items-center">
              <div className="rf-chronicle-seal">
                {/* The mark fills only ~64%×42% of its square viewBox, so the
                    box has to run well past the die's apparent size. */}
                <InlineSvg markup={iconMono} className="h-16 text-[#b083db] opacity-90" />
              </div>
              <p className="rf-chronicle-colophon">
                {t('chronicle.colophon1')}
                <br />
                {t('chronicle.colophon2')}
              </p>
            </footer>
          </div>
        </div>

        <div className="rf-chronicle-rod" aria-hidden />
      </article>
    </div>
  );
}
