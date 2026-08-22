import { useState } from 'react';
import { Play, RefreshCw, Terminal, Gamepad2, X, Square } from 'lucide-react';
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
  const feedError = useNewsStore((s) => s.feedError);

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
  const [stopping, setStopping] = useState(false);
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
        // A refusal the launcher raised about the profile comes with a key,
        // and is said in the player's language; anything else is a diagnostic
        // and arrives in English, which is also what the log holds.
        setLaunchError(
          result.errorMessage
            ? t(result.errorMessage.key, result.errorMessage.vars)
            : (result.error ?? t('home.launchFailed')),
        );
      }
    } catch {
      setLaunchError(t('home.launchError'));
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

  /**
   * Stop a game that is already up.
   *
   * `killGame` — SIGTERM, then SIGKILL after ten seconds, and it does not report
   * success until the process has actually gone — has been complete since the
   * launcher could start a game, and nothing called it: a Minecraft that hung on
   * its splash screen could only be dealt with from outside the launcher. The
   * running state is not cleared here; the process's own `exit` handler sends
   * `game:exited`, which is the one event that means it really stopped.
   */
  const handleStop = async () => {
    if (!selectedId) return;
    setStopping(true);
    try {
      const result = await api.game.kill(selectedId);
      if (!result.success) setLaunchError(result.error ?? t('home.stopFailed'));
    } finally {
      setStopping(false);
    }
  };

  // One banner at a time, in feed order — the publisher decides what is most
  // urgent, and a stack of them pushes the launch button off the fold. Dismiss
  // it and the next one takes its place.
  const announcement = announcements.find((a) => !dismissedIds.has(a.id));

  return (
    // `isolate` is load-bearing: without it this container is no stacking
    // context (position alone doesn't make one), so the backdrop's -z-10
    // resolves against the root context and paints UNDER the app shell's
    // opaque `bg-rf-bg` — i.e. invisibly.
    <div className="relative isolate flex h-full flex-col gap-4 p-6 overflow-y-auto">
      <ForgeBackdrop />

      {/* The announcement. Only one with something more to say is clickable —
          a banner that opens a dialog repeating its own single sentence teaches
          people the click is not worth making. */}
      {announcement && (
        // Everywhere else a banner sits on a page background; here it sits on
        // the backdrop, and its own `/10` tint is far too thin to be a surface
        // — over the Nether scene the text came out at 1.7:1. The wrapper is
        // the surface, so the tint has something known to be a tint *of*.
        <div className="rounded-lg bg-rf-bg">
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
        </div>
      )}

      {reading && <ArticleReader article={reading} onClose={() => setReading(null)} />}

      {/* Main launch area */}
      <div className="relative flex flex-1 flex-col items-center justify-center gap-6">
        {/* The only text in the app with artwork behind it rather than a
            surface, and the artwork is four scenes on a 45-second rotation —
            pale overworld, lava, cave, workshop — so there is no such thing as
            "the" background colour here to check a token against. Measured on
            the light theme's overworld, the loader/RAM line came out at 3.0:1.
            This pool of `--rf-bg` is what the column is read against instead;
            `-z-[5]` puts it over the backdrop's own -z-10 and under every
            sibling in normal flow. */}
        <div aria-hidden className="rf-launch-scrim pointer-events-none absolute inset-0 -z-[5]" />

        {/* Account display */}
        <div className="text-center">
          {activeAccount ? (
            <p className="text-sm text-rf-text-secondary">
              {t('home.signedInAs')}{' '}
              <span className="font-medium text-rf-text">{activeAccount.username}</span>
              {/* The union member itself was being printed here, so the line read
                  "Zalogowano jako Nick (microsoft)" — an internal identifier, lowercase
                  and untranslated, in the middle of a Polish sentence. */}
              <span className="ml-1 text-rf-text-muted">
                (
                {t(
                  activeAccount.type === 'microsoft'
                    ? 'home.accountMicrosoft'
                    : 'home.accountOffline',
                )}
                )
              </span>
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
              className="rounded-lg border border-rf-border bg-rf-surface px-4 py-2 text-sm text-rf-text outline-none focus:border-rf-accent-text min-w-[200px]"
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

        {/* And once it is up, the other half of the same offer. */}
        {runningNow && !preparingNow && (
          <Button
            variant="ghost"
            size="sm"
            icon={<Square size={14} />}
            loading={stopping}
            disabled={stopping}
            onClick={() => void handleStop()}
          >
            {stopping ? t('home.stopping') : t('home.stopGame')}
          </Button>
        )}

        {/* Say it before the click, not after the restart. Someone who presses
            Play and gets a relaunching launcher deserves to have been told. */}
        {pendingUpdate && updateStage !== 'failed' && (
          <p className="text-xs text-rf-accent-text">
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

        {/* No auto-dismiss, for the same reason as the offer below: most of
            these sentences end with something to go and change, and eight
            seconds is not long enough to read one and act on it. The next
            launch clears it, and so does the ×. */}
        {launchError && (
          <div className="w-full max-w-xl">
            <Banner type="urgent" dismissible onDismiss={() => setLaunchError(null)}>
              {launchError}
            </Banner>
          </div>
        )}

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

        {/* Console toggle. Deliberately outlives the game: gated on `runningNow`
            alone it vanished the instant the game exited and left an open
            console that only its own ✕ could dismiss. The log is worth keeping
            after an exit — that is when it explains something — so the console
            stays, and the button that closes it stays with it. */}
        {selectedId && settings?.showLiveConsole && (runningNow || isConsoleVisible) && (
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
        {selectedId && settings?.showLiveConsole && isConsoleVisible && (
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

        {/* A feed that cannot be reached says so. Left silent, a dead or
            mistyped URL is indistinguishable from a quiet week — the entries
            below simply stop being current and nothing marks the moment. */}
        {feedError && (
          <p className="mb-2 text-xs text-rf-warning">
            {news.length > 0 ? t('home.newsStale') : t('home.newsUnavailable')}
          </p>
        )}

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
