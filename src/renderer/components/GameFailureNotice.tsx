// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { Button } from '@components/ui/Button';
import { Banner } from '@components/ui/Banner';
import { useGameStore, type GameFailure } from '@stores/game-store';
import { useT, type TFunction } from '@renderer/i18n';

/** A failure with nothing to offer but its explanation. */
function describe(
  t: TFunction,
  failure: Exclude<GameFailure, { kind: 'auth-unreachable' }>,
): string {
  switch (failure.kind) {
    case 'refused':
      return t(failure.message.key, failure.message.vars);
    case 'launch-failed':
      return failure.error ?? t('home.launchFailed');
    case 'stop-failed':
      return failure.error ?? t('home.stopFailed');
  }
}

/**
 * Why the last attempt to start or stop this profile's game did not work.
 *
 * Drawn beside every control that starts a game — Play and Quick connect — out
 * of the one record the game store keeps, so it is there to be read whichever
 * page the launch was started from and whichever page it failed under.
 *
 * Nothing here dismisses itself. Most of these sentences end with something to
 * go and change, and the offline offer asks a question: a notice that goes
 * away while it is being read cannot be acted on, and cannot be answered. The
 * next attempt clears it, and so does the ×.
 */
export function GameFailureNotice({ profileId }: { profileId: string }) {
  const t = useT();
  const failure = useGameStore((s) => s.failures[profileId]);
  const launch = useGameStore((s) => s.launch);
  const clearFailure = useGameStore((s) => s.clearFailure);

  if (!failure) return null;

  if (failure.kind === 'auth-unreachable') {
    return (
      <div className="flex max-w-md flex-col items-center gap-2 rounded-lg border border-rf-warning/40 bg-rf-warning/10 p-3">
        <p className="text-xs text-rf-text-secondary">{t('home.authUnreachable')}</p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              void launch(profileId, { offlineMode: true, quickConnect: failure.quickConnect })
            }
          >
            {t('home.launchOffline')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => clearFailure(profileId)}>
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-xl">
      <Banner type="urgent" dismissible onDismiss={() => clearFailure(profileId)}>
        {describe(t, failure)}
      </Banner>
    </div>
  );
}
