import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { APP_NAME } from '@shared/constants';
import { REPO_URL, ORG_URL } from '@shared/branding';
import iconMono from '@assets/icons/icon-mono.svg?raw';
import { InlineSvg } from '@components/ui/InlineSvg';
import { BedrockInfoCard } from '@components/BedrockInfoCard';
import { ForgeChronicle } from '@components/ForgeChronicle';
import { ForgeBackdrop } from '@components/layout/ForgeBackdrop';
import { useT } from '@renderer/i18n';
import { interleave } from '@renderer/i18n/rich';

const api = window.ravenforge;

const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;
const AUTHOR_URL = 'https://github.com/pavlojs';

/**
 * Mojang's brand guidelines prescribe this sentence word for word, so it is not
 * a translation key — a localised paraphrase would no longer be the notice they
 * ask for. It stays in English in every UI language.
 */
const MOJANG_DISCLAIMER =
  'NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.';

/**
 * Opens in the user's browser, not in a launcher window — inherits its colour
 * from context (body text vs. footnote) and only picks up the accent on hover.
 */
function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => void api.system.openUrl(href)}
      className="underline decoration-current/30 underline-offset-2 transition-colors hover:text-rf-accent hover:decoration-rf-accent/60"
    >
      {children}
    </button>
  );
}

export function AboutPage() {
  const t = useT();
  const [chronicleOpen, setChronicleOpen] = useState(false);

  // Asked for rather than read from a constant: the main process answers with
  // `app.getVersion()`, which is the version of the build actually running.
  const [version, setVersion] = useState('');
  useEffect(() => {
    void api.system.getInfo().then((r) => {
      if (r.success && r.data) setVersion(r.data.launcherVersion);
    });
  }, []);

  return (
    // `isolate` is load-bearing — see HomePage for why the backdrop's -z-10
    // otherwise paints under the app shell's background.
    <div className="relative isolate flex h-full flex-col items-center justify-center gap-6 p-6">
      <ForgeBackdrop ambient />
      {/* The mark is drawn art; the name is set in the app's own display
          face. The README banner (`assets/brand/logo.svg`) exists for
          GitHub, where the app font isn't guaranteed — in-app we have
          Rajdhani for real, so live text beats a baked lockup here. */}
      <div className="flex flex-col items-center">
        <div className="flex items-center gap-3">
          {/* Easter egg. The mono mark has no eye, so one is overlaid at the
              spot the full icon puts it (200,200 of a 512 viewBox → 39.06%)
              and left almost invisible until hovered. Poking at a logo is a
              thing people do; the story it opens ends with an eye opening. */}
          <button
            type="button"
            onClick={() => setChronicleOpen(true)}
            className="rf-chronicle-trigger relative"
            aria-label={t('about.secret')}
          >
            <InlineSvg markup={iconMono} className="h-9 text-rf-accent" />
            <span className="rf-chronicle-spark" aria-hidden />
          </button>
          <h1 className="font-display text-3xl font-bold tracking-wider text-rf-accent">
            {APP_NAME}
          </h1>
        </div>
        <p className="mt-2 text-sm text-rf-text-muted">{version ? `v${version}` : ''}</p>
      </div>

      <div className="max-w-md space-y-3 text-center text-sm text-rf-text-secondary">
        <p>{t('about.tagline')}</p>
        {/* The two names are links, so the sentence is assembled from the
            translated string around `{author}` and `{org}` rather than being
            split into fragments a translator could not reorder. */}
        <p>
          {interleave(t('about.authorship'), {
            author: <ExtLink href={AUTHOR_URL}>pavlojs</ExtLink>,
            org: <ExtLink href={ORG_URL}>White Ravens</ExtLink>,
          })}
        </p>
        <p className="text-rf-text-muted">{t('about.stack')}</p>
      </div>

      <BedrockInfoCard />

      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-rf-text-muted">
        <ExtLink href={REPO_URL}>GitHub</ExtLink>
        <span aria-hidden>•</span>
        <ExtLink href={LICENSE_URL}>PolyForm Noncommercial 1.0.0</ExtLink>
        <span aria-hidden>•</span>
        <span>
          © 2026 <ExtLink href={ORG_URL}>White Ravens</ExtLink>
        </span>
      </div>

      <p className="max-w-md text-center text-[11px] leading-relaxed tracking-wide text-rf-text-muted">
        {MOJANG_DISCLAIMER}
      </p>

      {chronicleOpen && <ForgeChronicle onClose={() => setChronicleOpen(false)} />}
    </div>
  );
}
