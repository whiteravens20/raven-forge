// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { useEffect, useState } from 'react';
import { X, Server, Hammer, Package, ArrowLeft, Download, Search } from 'lucide-react';
import { ModrinthPackSearch } from '@components/ModrinthPackSearch';
import { Button } from '@components/ui/Button';
import { Input } from '@components/ui/Input';
import { Banner } from '@components/ui/Banner';
import { formatBytes } from '@renderer/format';
import { localized, useLocale, useT } from '@renderer/i18n';
import { loaderLabel } from '@shared/labels';
import { formatRamGb, ramAdvice, safeMaxRamMb } from '@shared/memory';
import type { CataloguePack, IpcResult, PackInstall, Profile } from '@shared/ipc-types';
import { useDialogFocus } from '@hooks/use-dialog-focus';
import { useMachineMemoryMb } from '@hooks/use-machine-memory';

const api = window.ravenforge;

interface Props {
  onCancel: () => void;
  /** Build a profile by hand — hands back to the ordinary create form. */
  onScratch: () => void;
  /**
   * A profile arrived, and is the one to select. Two things may need saying
   * about it, and the page says them where the profile is on screen: `dropped`
   * names what a profile file carried that an import leaves out, and
   * `unfinished` is why a pack's files did not all arrive.
   */
  onCreated: (profile: Profile, said?: { dropped?: string[]; unfinished?: string }) => void;
}

type Route = 'choose' | 'white-ravens' | 'modrinth' | 'import';

/**
 * Where a new profile comes from.
 *
 * Four routes, because "new profile" means four genuinely different things: a
 * pack somebody else maintains and keeps updating, a public pack to go and
 * find, an empty profile to build up by hand, and a file you already have.
 * Presenting only the third of those — an empty form — is what the button used
 * to do, and it made the common case (play on the server) the one nobody could
 * find.
 */
export function ProfileSourcePicker({ onCancel, onScratch, onCreated }: Props) {
  const t = useT();
  const dialogRef = useDialogFocus<HTMLDivElement>();
  const locale = useLocale();
  const machineMemoryMb = useMachineMemoryMb();
  const [route, setRoute] = useState<Route>('choose');
  const [packs, setPacks] = useState<CataloguePack[] | null>(null);
  /** True when the catalogue could not be fetched — which is not "no packs". */
  const [listFailed, setListFailed] = useState(false);
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

  // Fetched when that route is opened, not on mount: the other routes never
  // need it, and a network round trip to draw a menu is a menu that lags.
  //
  // A fetch that failed leaves the list unknown, not empty. It used to be
  // recorded as an empty list: going back and in again then said "no packs are
  // published yet", with the error gone and nothing left to try again with.
  useEffect(() => {
    if (route !== 'white-ravens' || packs || listFailed) return;
    let cancelled = false;
    void api.packs.listCatalogue().then((r) => {
      if (cancelled) return;
      if (r.success && r.data) setPacks(r.data);
      else {
        setListFailed(true);
        setError(r.error ?? t('packs.listFailed'));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [route, packs, listFailed, t]);

  /**
   * Hand a pack install's outcome on.
   *
   * A failure here means no profile was made, and is said in this dialog. An
   * install that made one and then stopped short is not that: the profile
   * exists and can be synced again, so it goes to the page like any other —
   * staying here to offer "Install" again is how each retry used to leave
   * another half-filled profile of the same name behind.
   */
  const installed = (result: IpcResult<PackInstall>, fallback: string) => {
    if (!result.success || !result.data) setError(result.error ?? fallback);
    else onCreated(result.data.profile, { unfinished: result.data.failure });
  };

  const installPack = async (pack: CataloguePack) => {
    setBusy(pack.slug);
    setError(null);
    const result = await api.packs.createFromManifest(pack.manifestUrl);
    setBusy(null);
    installed(result, t('packs.installFailed', { name: pack.name }));
  };

  const importFile = async () => {
    const picked = await api.system.selectFile([{ name: 'Modrinth pack', extensions: ['mrpack'] }]);
    if (!picked.success || !picked.data) return;

    setBusy('file');
    setError(null);
    const result = await api.packs.importMrpack(picked.data);
    setBusy(null);
    installed(result, t('packs.importFailed'));
  };

  // The settings of one profile, as this launcher's own Export wrote them. It
  // lives here, beside the pack file, because both are "I have a file" — it
  // used to be an unlabelled icon above the profile list that nobody found.
  const importProfileFile = async () => {
    setBusy('profile');
    setError(null);
    const result = await api.profiles.import();
    setBusy(null);
    if (!result.success) setError(result.error ?? t('packs.profileFileFailed'));
    else if (result.data) onCreated(result.data.profile, { dropped: result.data.dropped });
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
    installed(result, t('packs.manifestFailed'));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      role="presentation"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-rf-border bg-rf-bg-secondary shadow-2xl outline-none"
        ref={dialogRef}
        tabIndex={-1}
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
                // Coming back in asks again.
                setListFailed(false);
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
                : route === 'modrinth'
                  ? t('packs.modrinthTitle')
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
                badge={t('packs.whitelist')}
                body={t('packs.wrBody')}
                onClick={() => setRoute('white-ravens')}
              />
              <SourceCard
                icon={<Search size={18} />}
                title={t('packs.modrinthTitle')}
                body={t('packs.modrinthBody')}
                onClick={() => setRoute('modrinth')}
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
              {/* Said before the install, not after it: the pack downloads for
                  anyone, and finding out at the connect screen that the server
                  will not have you is the wrong moment to learn it. */}
              <p className="flex items-start gap-2 text-xs text-rf-text-muted">
                <WhitelistBadge label={t('packs.whitelist')} />
                {t('packs.whitelistNote')}
              </p>
              {packs === null && !listFailed && (
                <p className="text-sm text-rf-text-muted">{t('packs.loading')}</p>
              )}
              {listFailed && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="self-start"
                  onClick={() => {
                    setError(null);
                    setListFailed(false);
                  }}
                >
                  {t('packs.listRetry')}
                </Button>
              )}
              {packs?.length === 0 && (
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
                    <p className="text-xs text-rf-text-muted">
                      {localized(pack.summaryI18n, locale, pack.summary)}
                    </p>
                    <p className="mt-0.5 text-xs text-rf-text-muted">
                      MC {pack.minecraftVersion} • {loaderLabel(pack.modLoader)} •{' '}
                      {t.plural('packs.mods', pack.modCount)}
                      {pack.totalDownloadBytes > 0 && ` • ${formatBytes(pack.totalDownloadBytes)}`}
                      {pack.recommendedRamMb !== undefined &&
                        ` • ${t('packs.ram', { ram: formatRamGb(pack.recommendedRamMb) })}`}
                    </p>
                    {/* Before the download, which is the moment it can still
                        change somebody's mind. The install gives the profile
                        what the machine can spare either way. */}
                    {pack.recommendedRamMb !== undefined &&
                      ramAdvice(pack.recommendedRamMb, machineMemoryMb) !== 'ok' && (
                        <p className="mt-0.5 text-xs text-rf-warning">
                          {t('packs.ramShort', {
                            wanted: formatRamGb(pack.recommendedRamMb),
                            spare: formatRamGb(safeMaxRamMb(machineMemoryMb)),
                          })}
                        </p>
                      )}
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

          {route === 'modrinth' && (
            <ModrinthPackSearch
              onBusy={(installing) => setBusy(installing ? 'modrinth' : null)}
              onInstalled={(install) => onCreated(install.profile, { unfinished: install.failure })}
            />
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

              <div className="rounded-lg border border-rf-border p-3">
                <p className="text-sm font-medium text-rf-text">{t('packs.profileFileTitle')}</p>
                <p className="mt-0.5 text-xs text-rf-text-muted">{t('packs.profileFileBody')}</p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-2"
                  loading={busy === 'profile'}
                  disabled={Boolean(busy)}
                  onClick={() => void importProfileFile()}
                >
                  {t('packs.chooseFile')}
                </Button>
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
  badge,
  body,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  /** A condition on this route, worth seeing before it is chosen. */
  badge?: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-lg border border-rf-border p-4 text-left transition-colors hover:border-rf-accent hover:bg-rf-accent/5"
    >
      <span className="mt-0.5 shrink-0 text-rf-accent-text">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-medium text-rf-text">
          {title}
          {badge && <WhitelistBadge label={badge} />}
        </span>
        <span className="mt-0.5 block text-xs text-rf-text-muted">{body}</span>
      </span>
    </button>
  );
}

/** The pill itself, so the card and the pack list cannot drift apart. */
function WhitelistBadge({ label }: { label: string }) {
  return (
    <span className="shrink-0 rounded border border-rf-warning/30 bg-rf-warning/10 px-1.5 py-0.5 text-xs font-medium text-rf-warning">
      {label}
    </span>
  );
}
