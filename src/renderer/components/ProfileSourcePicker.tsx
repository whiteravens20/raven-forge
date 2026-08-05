import { useEffect, useState } from 'react';
import { X, Server, Hammer, Package, ArrowLeft, Download } from 'lucide-react';
import { Button } from '@components/ui/Button';
import { Input } from '@components/ui/Input';
import { Banner } from '@components/ui/Banner';
import { formatBytes } from '@renderer/format';
import { useT } from '@renderer/i18n';
import { loaderLabel } from '@shared/labels';
import type { CataloguePack } from '@shared/ipc-types';

const api = window.ravenforge;

interface Props {
  onCancel: () => void;
  /** Build a profile by hand — hands back to the ordinary create form. */
  onScratch: () => void;
  /** A profile arrived; `profileId` is the one to select. */
  onCreated: (profileId: string) => void;
}

type Route = 'choose' | 'white-ravens' | 'import';

/**
 * Where a new profile comes from.
 *
 * Three routes, because "new profile" means three genuinely different things: a
 * pack somebody else maintains and keeps updating, an empty profile to build up
 * by hand, and a pack file you already have. Presenting only the third of those
 * — an empty form — is what the button used to do, and it made the common case
 * (play on the server) the one nobody could find.
 */
export function ProfileSourcePicker({ onCancel, onScratch, onCreated }: Props) {
  const t = useT();
  const [route, setRoute] = useState<Route>('choose');
  const [packs, setPacks] = useState<CataloguePack[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [packUrl, setPackUrl] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, busy]);

  // Fetched when that route is opened, not on mount: two of the three routes
  // never need it, and a network round trip to draw a menu is a menu that lags.
  useEffect(() => {
    if (route !== 'white-ravens' || packs) return;
    let cancelled = false;
    void api.packs.listCatalogue().then((r) => {
      if (cancelled) return;
      if (r.success && r.data) setPacks(r.data);
      else {
        setPacks([]);
        setError(r.error ?? t('packs.listFailed'));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [route, packs, t]);

  const installPack = async (pack: CataloguePack) => {
    setBusy(pack.slug);
    setError(null);
    const result = await api.packs.createFromManifest(pack.manifestUrl);
    setBusy(null);
    if (result.success && result.data) onCreated(result.data.id);
    else setError(result.error ?? t('packs.installFailed', { name: pack.name }));
  };

  const importFile = async () => {
    const picked = await api.system.selectFile([{ name: 'Modrinth pack', extensions: ['mrpack'] }]);
    if (!picked.success || !picked.data) return;

    setBusy('file');
    setError(null);
    const result = await api.packs.importMrpack(picked.data);
    setBusy(null);
    if (result.success && result.data) onCreated(result.data.id);
    else setError(result.error ?? t('packs.importFailed'));
  };

  // One field for both kinds of link. Which one it is gets decided in the main
  // process from the bytes at the address, so there is nothing here for the
  // player to pick wrong.
  const followUrl = async () => {
    const url = packUrl.trim();
    if (!url) return;
    setBusy('url');
    setError(null);
    const result = await api.packs.createFromUrl(url);
    setBusy(null);
    if (result.success && result.data) onCreated(result.data.id);
    else setError(result.error ?? t('packs.manifestFailed'));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      role="presentation"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-rf-border bg-rf-bg-secondary shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-title"
      >
        <header className="flex items-center gap-2 border-b border-rf-border px-5 py-3">
          {route !== 'choose' && (
            <button
              onClick={() => {
                setRoute('choose');
                setError(null);
              }}
              disabled={Boolean(busy)}
              aria-label={t('common.back')}
              className="text-rf-text-muted hover:text-rf-text disabled:opacity-40"
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <h2 id="source-title" className="flex-1 text-sm font-display font-semibold text-rf-text">
            {route === 'choose'
              ? t('packs.title')
              : route === 'white-ravens'
                ? t('packs.wrTitle')
                : t('packs.importTitle')}
          </h2>
          <button
            onClick={onCancel}
            disabled={Boolean(busy)}
            aria-label={t('common.close')}
            className="text-rf-text-muted hover:text-rf-text disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {error && <Banner type="urgent">{error}</Banner>}

          {route === 'choose' && (
            <>
              <SourceCard
                icon={<Server size={18} />}
                title={t('packs.wrTitle')}
                body={t('packs.wrBody')}
                onClick={() => setRoute('white-ravens')}
              />
              <SourceCard
                icon={<Hammer size={18} />}
                title={t('packs.scratchTitle')}
                body={t('packs.scratchBody')}
                onClick={onScratch}
              />
              <SourceCard
                icon={<Package size={18} />}
                title={t('packs.importTitle')}
                body={t('packs.importBody')}
                onClick={() => setRoute('import')}
              />
            </>
          )}

          {route === 'white-ravens' && (
            <>
              {packs === null && <p className="text-sm text-rf-text-muted">{t('packs.loading')}</p>}
              {packs?.length === 0 && !error && (
                <p className="text-sm text-rf-text-muted">{t('packs.none')}</p>
              )}
              {packs?.map((pack) => (
                <div
                  key={pack.slug}
                  className="flex items-center gap-3 rounded-lg border border-rf-border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-rf-text">
                      {pack.name}{' '}
                      <span className="font-normal text-rf-text-muted">{pack.version}</span>
                    </p>
                    <p className="text-xs text-rf-text-muted">{pack.summary}</p>
                    <p className="mt-0.5 text-xs text-rf-text-muted">
                      MC {pack.minecraftVersion} • {loaderLabel(pack.modLoader)} •{' '}
                      {t.plural('packs.mods', pack.modCount)}
                      {pack.totalDownloadBytes > 0 && ` • ${formatBytes(pack.totalDownloadBytes)}`}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Download size={14} />}
                    loading={busy === pack.slug}
                    disabled={Boolean(busy)}
                    onClick={() => void installPack(pack)}
                  >
                    {t('common.install')}
                  </Button>
                </div>
              ))}
              {/* Said once, here, because it is the difference between this
                  route and the other two: these keep themselves up to date. */}
              {packs && packs.length > 0 && (
                <p className="text-xs text-rf-text-muted">{t('packs.wrSyncNote')}</p>
              )}
            </>
          )}

          {route === 'import' && (
            <>
              <div className="rounded-lg border border-rf-border p-3">
                <p className="text-sm font-medium text-rf-text">{t('packs.fileTitle')}</p>
                <p className="mt-0.5 text-xs text-rf-text-muted">{t('packs.fileBody')}</p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-2"
                  loading={busy === 'file'}
                  disabled={Boolean(busy)}
                  onClick={() => void importFile()}
                >
                  {t('packs.chooseFile')}
                </Button>
              </div>

              <div className="rounded-lg border border-rf-border p-3">
                <p className="text-sm font-medium text-rf-text">{t('packs.urlTitle')}</p>
                <p className="mt-0.5 mb-2 text-xs text-rf-text-muted">{t('packs.urlBody')}</p>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void followUrl();
                  }}
                >
                  <div className="flex-1">
                    <Input
                      placeholder="https://…/pack.mrpack"
                      value={packUrl}
                      onChange={(e) => setPackUrl(e.target.value)}
                    />
                  </div>
                  <Button
                    size="sm"
                    type="submit"
                    variant="secondary"
                    loading={busy === 'url'}
                    disabled={Boolean(busy) || !packUrl.trim()}
                  >
                    {t('common.add')}
                  </Button>
                </form>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SourceCard({
  icon,
  title,
  body,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-lg border border-rf-border p-4 text-left transition-colors hover:border-rf-accent hover:bg-rf-accent/5"
    >
      <span className="mt-0.5 shrink-0 text-rf-accent">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-rf-text">{title}</span>
        <span className="mt-0.5 block text-xs text-rf-text-muted">{body}</span>
      </span>
    </button>
  );
}
