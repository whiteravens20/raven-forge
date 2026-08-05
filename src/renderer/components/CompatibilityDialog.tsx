import { useEffect } from 'react';
import { AlertTriangle, X, Package } from 'lucide-react';
import { Button } from '@components/ui/Button';
import { useT, type TFunction } from '@renderer/i18n';
import { loaderLabel } from '@shared/labels';
import type { CompatibilityIssue, InstallPlan } from '@shared/ipc-types';

interface Props {
  plan: InstallPlan;
  busy: boolean;
  onCancel: () => void;
  onInstall: () => void;
}

/** One issue as a sentence, with whatever the metadata could say about it. */
function describe(t: TFunction, issue: CompatibilityIssue): string {
  switch (issue.kind) {
    case 'wrong-loader':
      return t('compat.wrongLoader', { loaders: issue.supported.map(loaderLabel).join(', ') });
    case 'wrong-version':
      return t('compat.wrongVersion', { versions: issue.supported.join(', ') });
    case 'no-build':
      return t('compat.noBuild');
    case 'needs-loader':
      return t('compat.needsLoader');
    case 'conflicts-with':
      return t('compat.conflictsWith', { names: issue.names.join(', ') });
    case 'dependency-no-build':
      return t('compat.dependencyNoBuild', { names: issue.names.join(', ') });
  }
}

/**
 * What is wrong with installing this, and a way to do it regardless.
 *
 * It warns rather than refuses. Modrinth's compatibility data is what a
 * publisher got round to filling in — mods work on Minecraft versions their
 * author never listed, and Quilt profiles run Fabric builds that say nothing
 * about Quilt — so a launcher treating that metadata as binding would refuse
 * installs that work fine. The player is told precisely what does not line up
 * and decides.
 *
 * The one case with no way through is a project publishing nothing at all: there
 * is no file, so there is no decision, and offering the button would be a lie.
 */
export function CompatibilityDialog({ plan, busy, onCancel, onInstall }: Props) {
  const t = useT();
  const installable = Boolean(plan.versionId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, busy]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      role="presentation"
    >
      <div
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-rf-border bg-rf-bg-secondary shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="compat-title"
      >
        <header className="flex items-center gap-2 border-b border-rf-border px-5 py-3">
          <AlertTriangle size={15} className="shrink-0 text-rf-warning" />
          <h2 id="compat-title" className="flex-1 text-sm font-display font-semibold text-rf-text">
            {t('compat.title', { name: plan.name })}
          </h2>
          <button
            onClick={onCancel}
            disabled={busy}
            aria-label={t('common.close')}
            className="text-rf-text-muted hover:text-rf-text disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </header>

        <div className="space-y-3 px-5 py-4">
          <ul className="space-y-2">
            {plan.issues.map((issue, index) => (
              <li
                key={`${issue.kind}-${index}`}
                className="flex items-start gap-2 rounded-lg border border-rf-warning/30 bg-rf-warning/10 px-3 py-2 text-sm text-rf-warning"
              >
                <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>{describe(t, issue)}</span>
              </li>
            ))}
          </ul>

          {/* Named before the fact, not reported after it. Files appearing in a
              profile nobody asked for is how a profile becomes unexplainable. */}
          {plan.dependencies.length > 0 && (
            <p className="flex items-start gap-2 text-sm text-rf-text-secondary">
              <Package
                size={16}
                className="mt-0.5 shrink-0 text-rf-text-muted"
                aria-hidden="true"
              />
              <span>
                {t('compat.alsoInstalls', {
                  deps: plan.dependencies.map((d) => d.name).join(', '),
                })}
              </span>
            </p>
          )}

          {installable ? (
            <p className="text-sm text-rf-text-secondary">
              {t('compat.anywayHint', { version: plan.versionName ?? '' })}
            </p>
          ) : (
            <p className="text-sm text-rf-text-secondary">{t('compat.nothingToInstall')}</p>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-rf-border px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            {installable ? t('common.cancel') : t('common.close')}
          </Button>
          {installable && (
            <Button variant="secondary" size="sm" loading={busy} onClick={onInstall}>
              {t('compat.installAnyway')}
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}
