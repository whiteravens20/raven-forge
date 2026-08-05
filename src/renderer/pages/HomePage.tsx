import { useState } from 'react';
import { Play, RefreshCw, Terminal, Gamepad2, X } from 'lucide-react';
import { useProfileStore } from '@stores/profile-store';
import { useAuthStore } from '@stores/auth-store';
import { useNewsStore } from '@stores/news-store';
import { useGameStore } from '@stores/game-store';
import { useSettingsStore } from '@stores/settings-store';
import { Button } from '@components/ui/Button';
import { Banner } from '@components/ui/Banner';
import { LiveConsole } from '@components/LiveConsole';
import { NewsStrip } from '@components/NewsStrip';
import { ProfileAvatar } from '@components/ProfileAvatar';
import { CrashReporter } from '@components/CrashReporter';
import { ArticleReader, type Article } from '@components/ArticleReader';
import { BackgroundRotator } from '@components/layout/BackgroundRotator';
import { ForgeBackdrop } from '@components/layout/ForgeBackdrop';
import { useLocale, useT } from '@renderer/i18n';
import { loaderLabel } from '@shared/labels';
import { useUpdaterStore } from '@stores/updater-store';

const api = window.ravenforge;

/** Feed dates are ISO strings from a file someone hand-edits; show what parses. */
function formatDate(iso: string, locale: string): string | undefined {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date.toLocaleDateString(locale);
}

export function HomePage() {
  const profiles = useProfileStore((s) => s.profiles);
  const selectedId = useProfileStore((s) => s.selectedProfileId);
  const selectProfile = useProfileStore((s) => s.select);

  const activeAccountId = useAuthStore((s) => s.activeAccountId);
  const accounts = useAuthStore((s) => s.accounts);

  const news = useNewsStore((s) => s.news);
  const announcements = useNewsStore((s) => s.announcements);
  const dismissedIds = useNewsStore((s) => s.dismissedIds);
  const dismiss = useNewsStore((s) => s.dismiss);
  const refreshNews = useNewsStore((s) => s.refresh);

  const settings = useSettingsStore((s) => s.settings);

  // Both selected as derived booleans, not as the predicate functions.
  // `useGameStore((s) => s.isRunning)` returns a stable function reference, so
  // it never changes and never re-renders: closing the game left the button
  // reading "Running" until some unrelated state (opening the console, say)
  // forced a render. Select the value, not the getter.
  const runningNow = useGameStore((s) => (selectedId ? s.running.has(selectedId) : false));
  const preparingNow = useGameStore((s) => (selectedId ? s.preparing.has(selectedId) : false));
  const beginPreparing = useGameStore((s) => s.beginPreparing);
  const endPreparing = useGameStore((s) => s.endPreparing);
  const crashInfo = useGameStore((s) => (selectedId ? s.getCrashInfo(selectedId) : undefined));
  const clearCrash = useGameStore((s) => s.clearCrash);
  const toggleConsole = useGameStore((s) => s.toggleConsole);
  const isConsoleVisible = useGameStore((s) =>
    selectedId ? s.isConsoleVisible(selectedId) : false,
  );

  const [launchError, setLaunchError] = useState<string | null>(null);
  /** The news item or announcement currently open in the reader. */
  const [reading, setReading] = useState<Article | null>(null);
  /** Set when a launch failed only because the auth servers could not be reached. */
  const [offlineOffer, setOfflineOffer] = useState(false);
  const pendingUpdate = useUpdaterStore((s) => s.available);
  const updateStage = useUpdaterStore((s) => s.stage);
  const downloadPending = useUpdaterStore((s) => s.downloadPending);
  const installUpdate = useUpdaterStore((s) => s.install);
  const dismissUpdate = useUpdaterStore((s) => s.dismiss);
  const t = useT();
  const locale = useLocale();

  const selectedProfile = profiles.find((p) => p.id === selectedId);
  const activeAccount = accounts.find((a) => a.id === activeAccountId);
  const busyNow = runningNow || preparingNow;

  /**
   * @param offlineMode `true` retries a launch that failed because the auth
   *        servers were unreachable. Left undefined the global setting decides.
   */
  const handleLaunch = async (offlineMode?: boolean) => {
    if (!selectedId || !selectedProfile || busyNow) return;

    // A waiting launcher update is installed before the game starts, because a
    // launcher that is about to replace itself should not first spend minutes
    // downloading assets and then restart out from under a running game.
    //
    // Only a *known* update blocks this. The state comes from the startup
    // check's events, so a click never waits on the network — and a failed or
    // never-completed check leaves `available` null and play proceeds.
    if (pendingUpdate && updateStage !== 'failed') {
      const ready = await downloadPending();
      if (ready) {
        await installUpdate(); // quits and relaunches into the new version
        return;
      }
      // Download failed: say so, and let the game start anyway. Being unable to
      // update is not a reason to be unable to play.
    }

    setLaunchError(null);
    setOfflineOffer(false);
    clearCrash(selectedId);
    beginPreparing(selectedId);
    try {
      const result = await api.game.launch({ profileId: selectedId, offlineMode });
      if (!result.success) {
        // Unreachable is recoverable and rejected is not, so only one of them
        // gets an offer — and this banner stays until it is acted on rather
        // than timing out under the reader.
        if (result.code === 'AUTH_UNREACHABLE') {
          setOfflineOffer(true);
          return;
        }
        setLaunchError(result.error ?? t('home.launchFailed'));
        setTimeout(() => setLaunchError(null), 8000);
      }
    } catch {
      setLaunchError(t('home.launchError'));
      setTimeout(() => setLaunchError(null), 8000);
    } finally {
      // `game:started` normally clears this; do it here too so a launch that
      // fails before spawning does not leave the button disabled forever.
      endPreparing(selectedId);
    }
  };

  const handleCancel = async () => {
    if (!selectedId) return;
    await api.game.cancel(selectedId);
    // Main resolves the launch call quietly after aborting; clear the button
    // here too so it frees up even if that resolution is slow.
    endPreparing(selectedId);
  };

  // One banner at a time, in feed order — the publisher decides what is most
  // urgent, and a stack of them pushes the launch button off the fold. Dismiss
  // it and the next one takes its place.
  const announcement = announcements.find((a) => !dismissedIds.has(a.id));

  const customPath = settings?.customBackgroundsPath;

  return (
    // `isolate` is load-bearing: without it this container is no stacking
    // context (position alone doesn't make one), so the backdrop's -z-10
    // resolves against the root context and paints UNDER the app shell's
    // opaque `bg-rf-bg` — i.e. invisibly.
    <div className="relative isolate flex h-full flex-col gap-4 p-6 overflow-y-auto">
      {/* The built-in backdrop is a live, theme-aware scene; the rotator only
          exists for user-supplied imagery, which is necessarily static. */}
      {customPath ? <BackgroundRotator images={[customPath]} /> : <ForgeBackdrop />}

      {/* The announcement. Only one with something more to say is clickable —
          a banner that opens a dialog repeating its own single sentence teaches
          people the click is not worth making. */}
      {announcement && (
        <Banner
          type={announcement.type}
          dismissible={announcement.dismissible}
          onDismiss={() => dismiss(announcement.id)}
        >
          {announcement.body || announcement.url ? (
            <button
              onClick={() =>
                setReading({
                  title: announcement.title ?? announcement.message,
                  subtitle: announcement.title ? announcement.message : undefined,
                  body: announcement.body,
                  excerpt: announcement.message,
                  url: announcement.url,
                })
              }
              className="text-left underline decoration-current/40 underline-offset-2 hover:decoration-current"
            >
              {announcement.message}
            </button>
          ) : (
            announcement.message
          )}
        </Banner>
      )}

      {reading && <ArticleReader article={reading} onClose={() => setReading(null)} />}

      {/* Main launch area */}
      <div className="flex flex-1 flex-col items-center justify-center gap-6">
        {/* Account display */}
        <div className="text-center">
          {activeAccount ? (
            <p className="text-sm text-rf-text-secondary">
              {t('home.signedInAs')}{' '}
              <span className="font-medium text-rf-text">{activeAccount.username}</span>
              <span className="ml-1 text-rf-text-muted">({activeAccount.type})</span>
            </p>
          ) : (
            <p className="text-sm text-rf-warning">{t('home.notSignedIn')}</p>
          )}
        </div>

        {/* Profile selector */}
        {profiles.length > 0 ? (
          <div className="flex items-center gap-3">
            {selectedProfile && <ProfileAvatar profile={selectedProfile} size={40} />}
            <select
              value={selectedId ?? ''}
              onChange={(e) => selectProfile(e.target.value)}
              className="rounded-lg border border-rf-border bg-rf-surface px-4 py-2 text-sm text-rf-text outline-none focus:border-rf-accent min-w-[200px]"
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — MC {p.minecraftVersion}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="text-sm text-rf-text-muted">{t('home.noProfiles')}</p>
        )}

        {/* Crash reporter */}
        {selectedProfile && crashInfo && crashInfo.crashed && (
          <div className="w-full max-w-lg">
            <CrashReporter
              crashInfo={crashInfo}
              profileName={selectedProfile.name}
              onDismiss={() => clearCrash(selectedProfile.id)}
            />
          </div>
        )}

        {/* Launch button */}
        <Button
          variant="primary"
          size="lg"
          // Spinner only while preparing. Once the game is up nothing is
          // pending, so a spinning ring would be lying about ongoing work.
          icon={preparingNow ? undefined : runningNow ? <Gamepad2 size={18} /> : <Play size={18} />}
          loading={preparingNow}
          disabled={!selectedProfile || !activeAccount || busyNow}
          onClick={() => void handleLaunch()}
          className={`px-12 py-3 text-base font-display font-bold tracking-wider uppercase ${
            busyNow ? '' : 'animate-pulse-glow'
          }`}
        >
          {updateStage === 'downloading'
            ? t('home.updatingLauncher')
            : preparingNow
              ? t('home.preparing')
              : runningNow
                ? t('home.running')
                : t('home.play')}
        </Button>

        {/* Only while preparing: once the game is up there is no download to stop. */}
        {preparingNow && (
          <Button variant="ghost" size="sm" icon={<X size={14} />} onClick={handleCancel}>
            {t('home.cancelLaunch')}
          </Button>
        )}

        {/* Say it before the click, not after the restart. Someone who presses
            Play and gets a relaunching launcher deserves to have been told. */}
        {pendingUpdate && updateStage !== 'failed' && (
          <p className="text-xs text-rf-accent">
            {t('home.updateBeforePlay', { version: pendingUpdate.version })}
          </p>
        )}
        {updateStage === 'failed' && (
          <p className="text-xs text-rf-text-muted">
            {t('home.updateFailedPlayAnyway')}{' '}
            <button onClick={dismissUpdate} className="underline hover:text-rf-text">
              {t('common.dismiss')}
            </button>
          </p>
        )}

        {launchError && <p className="text-xs text-rf-danger">{launchError}</p>}

        {/* No auto-dismiss: this one asks a question, and a banner that
            disappears while being read cannot be answered. */}
        {offlineOffer && (
          <div className="flex max-w-md flex-col items-center gap-2 rounded-lg border border-rf-warning/40 bg-rf-warning/10 p-3">
            <p className="text-xs text-rf-text-secondary">{t('home.authUnreachable')}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => void handleLaunch(true)}>
                {t('home.launchOffline')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOfflineOffer(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}

        {selectedProfile && (
          <p className="text-xs text-rf-text-muted">
            {selectedProfile.modLoader !== 'vanilla'
              ? `${loaderLabel(selectedProfile.modLoader)} ${selectedProfile.modLoaderVersion ?? ''}`
              : 'Vanilla'}{' '}
            • {t('home.ram', { mb: selectedProfile.allocatedRamMb })}
          </p>
        )}

        {/* Console toggle */}
        {selectedId && settings?.showLiveConsole && runningNow && (
          <Button
            variant="ghost"
            size="sm"
            icon={<Terminal size={14} />}
            onClick={() => toggleConsole(selectedId, !isConsoleVisible)}
          >
            {isConsoleVisible ? t('home.hideConsole') : t('home.showConsole')}
          </Button>
        )}

        {/* Live console */}
        {selectedId && isConsoleVisible && (
          <div className="w-full max-w-2xl">
            <LiveConsole profileId={selectedId} onClose={() => toggleConsole(selectedId, false)} />
          </div>
        )}
      </div>

      {/* News section */}
      <div className="shrink-0">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-display font-semibold text-rf-text-secondary uppercase tracking-wider">
            {t('home.news')}
          </h2>
          <button
            onClick={refreshNews}
            aria-label={t('home.refreshNews')}
            className="text-rf-text-muted hover:text-rf-text-secondary"
          >
            <RefreshCw size={14} />
          </button>
        </div>
        <NewsStrip
          items={news}
          onOpen={(item) =>
            setReading({
              title: item.title,
              subtitle: formatDate(item.publishedAt, locale),
              body: item.body,
              excerpt: item.excerpt,
              url: item.url,
            })
          }
        />
      </div>
    </div>
  );
}
