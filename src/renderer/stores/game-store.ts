// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { create } from 'zustand';
import type { ErrorMessage, GameExitInfo, LaunchOptions } from '@shared/ipc-types';
import { useProfileStore } from './profile-store';

const api = window.ravenforge;

/**
 * Why the last attempt to start or stop a profile's game did not work.
 *
 * Kept as what happened rather than as a sentence: the page that shows it picks
 * the words, in whatever language it is in at the time.
 */
export type GameFailure =
  /**
   * The sign-in servers could not be reached — as opposed to refusing. That one
   * is recoverable by launching offline, so it is an offer and not an error,
   * and it remembers whether the launch it interrupted was a quick connect.
   */
  | { kind: 'auth-unreachable'; quickConnect: boolean }
  /** The launcher refused because of how the profile is set up. */
  | { kind: 'refused'; message: ErrorMessage }
  /** Anything else: a diagnostic in the main process's English, or nothing. */
  | { kind: 'launch-failed'; error?: string }
  | { kind: 'stop-failed'; error?: string };

/** How long to leave it before asking again for a launch to be cancelled. */
const CANCEL_RETRY_MS = 250;

interface GameStore {
  /** Currently running profile IDs */
  running: Set<string>;
  /**
   * Profiles between the launch click and the game process actually starting.
   *
   * That gap is not short — it covers manifest sync, mod loader install, the
   * JRE download and several thousand assets. `running` only fills in once the
   * process spawns, so without this the launch button stays enabled for minutes
   * and a second click starts the whole download a second time.
   */
  preparing: Set<string>;
  /** Profiles whose launch has been asked to stop and has not yet let go. */
  cancelling: Set<string>;
  /** Profiles whose game has been asked to stop and has not yet exited. */
  stopping: Set<string>;
  /** Most recent crash info per profile */
  crashInfo: Record<string, GameExitInfo>;
  /**
   * The last failure per profile, until the next attempt or a dismissal.
   *
   * Here and not in a page's own state, because a launch outlives the page it
   * was started from: it runs for minutes, people go and look at their mods
   * meanwhile, and a failure recorded in a page that had since unmounted was
   * simply lost — Play was idle again and nothing said why.
   */
  failures: Record<string, GameFailure>;
  /** Whether a profile shows the console */
  consoleVisible: Set<string>;

  isRunning: (profileId: string) => boolean;
  isPreparing: (profileId: string) => boolean;
  isBusy: (profileId: string) => boolean;
  beginPreparing: (profileId: string) => void;
  endPreparing: (profileId: string) => void;
  hasCrashed: (profileId: string) => boolean;
  getCrashInfo: (profileId: string) => GameExitInfo | undefined;
  addRunning: (profileId: string) => void;
  removeRunning: (profileId: string, exitInfo?: GameExitInfo) => void;
  clearCrash: (profileId: string) => void;
  /**
   * Start a profile's game, and keep what became of the attempt.
   *
   * The one way in, for Play and for Quick connect alike. They used to be two
   * copies of the same call, and only one of them looked at the answer.
   */
  launch: (profileId: string, options?: Omit<LaunchOptions, 'profileId'>) => Promise<void>;
  /** Stop a launch that has not produced a game yet. */
  cancelLaunch: (profileId: string) => Promise<void>;
  /** Stop a game that is up. */
  stop: (profileId: string) => Promise<void>;
  clearFailure: (profileId: string) => void;
  isConsoleVisible: (profileId: string) => boolean;
  toggleConsole: (profileId: string, visible: boolean) => void;
}

/** A copy of one of the store's sets, with one profile added or taken out. */
function withId(ids: Set<string>, profileId: string, present: boolean): Set<string> {
  const next = new Set(ids);
  if (present) next.add(profileId);
  else next.delete(profileId);
  return next;
}

/**
 * Which launch of a profile is the one in flight, counted.
 *
 * `preparing` cannot tell two launches of one profile apart, and a cancel has
 * to: it keeps asking for as long as the launch it was pressed for is going,
 * and must not carry on into the next one started a moment after that ended.
 */
const attempts = new Map<string, number>();

export const useGameStore = create<GameStore>((set, get) => {
  // Subscribed once, here: this factory runs a single time, when the store is
  // created. The flag that used to guard it could never be anything but false.
  api.on('game:started', (pid) => {
    get().addRunning(pid);
  });
  api.on('game:exited', (info) => {
    get().removeRunning(info.profileId, info);
    // Main has just folded this session into the profile's play stats; re-read
    // so "last played" and the hour count update without a navigation.
    void useProfileStore.getState().load();
  });
  // The events only say what changes from here on. Asked once as well, for the
  // page that has just been reloaded while a game was up: its own record went
  // with the old page, and it would otherwise offer Play for a running game
  // and no way to stop it.
  void api.game.getRunning().then((result) => {
    for (const profileId of result.data ?? []) get().addRunning(profileId);
  });

  const fail = (profileId: string, failure: GameFailure) =>
    set((state) => ({ failures: { ...state.failures, [profileId]: failure } }));

  return {
    running: new Set(),
    preparing: new Set(),
    cancelling: new Set(),
    stopping: new Set(),
    crashInfo: {},
    failures: {},
    consoleVisible: new Set(),

    isRunning: (profileId) => get().running.has(profileId),
    isPreparing: (profileId) => get().preparing.has(profileId),
    isBusy: (profileId) => get().running.has(profileId) || get().preparing.has(profileId),
    hasCrashed: (profileId) => !!get().crashInfo[profileId]?.crashed,
    getCrashInfo: (profileId) => get().crashInfo[profileId],

    beginPreparing: (profileId) => {
      set((state) => {
        const next = new Set(state.preparing);
        next.add(profileId);
        return { preparing: next };
      });
    },

    endPreparing: (profileId) => {
      set((state) => {
        if (!state.preparing.has(profileId)) return state;
        const next = new Set(state.preparing);
        next.delete(profileId);
        return { preparing: next };
      });
    },

    addRunning: (profileId) => {
      set((state) => {
        const next = new Set(state.running);
        next.add(profileId);
        const stillPreparing = new Set(state.preparing);
        stillPreparing.delete(profileId);
        const newCrashInfo = { ...state.crashInfo };
        delete newCrashInfo[profileId];
        return { running: next, preparing: stillPreparing, crashInfo: newCrashInfo };
      });
    },

    removeRunning: (profileId, exitInfo) => {
      set((state) => {
        const next = new Set(state.running);
        next.delete(profileId);
        // A game that dies during startup never reaches `running`; clear the
        // preparing flag here too or the button stays stuck on "Starting…".
        const stillPreparing = new Set(state.preparing);
        stillPreparing.delete(profileId);
        const crashInfo = exitInfo?.crashed
          ? { ...state.crashInfo, [profileId]: exitInfo }
          : state.crashInfo;
        return { running: next, preparing: stillPreparing, crashInfo };
      });
    },

    clearCrash: (profileId) => {
      set((state) => {
        const next = { ...state.crashInfo };
        delete next[profileId];
        return { crashInfo: next };
      });
    },

    launch: async (profileId, options = {}) => {
      const { running, preparing } = get();
      if (running.has(profileId) || preparing.has(profileId)) return;

      attempts.set(profileId, (attempts.get(profileId) ?? 0) + 1);
      get().clearFailure(profileId);
      get().clearCrash(profileId);
      get().beginPreparing(profileId);
      try {
        const result = await api.game.launch({ profileId, ...options });
        if (result.success) return;
        // Unreachable is recoverable and rejected is not, so only one of them
        // becomes an offer. A refusal the launcher raised about the profile
        // comes with a key and is said in the player's language; anything else
        // is a diagnostic and arrives in English, which is what the log holds.
        if (result.code === 'AUTH_UNREACHABLE') {
          fail(profileId, {
            kind: 'auth-unreachable',
            quickConnect: Boolean(options.quickConnect),
          });
        } else if (result.errorMessage) {
          fail(profileId, { kind: 'refused', message: result.errorMessage });
        } else {
          fail(profileId, { kind: 'launch-failed', error: result.error });
        }
      } catch {
        fail(profileId, { kind: 'launch-failed' });
      } finally {
        // `game:started` normally clears this; do it here too so a launch that
        // fails before spawning does not leave the button disabled forever.
        get().endPreparing(profileId);
        set((state) => ({ cancelling: withId(state.cancelling, profileId, false) }));
      }
    },

    cancelLaunch: async (profileId) => {
      if (!get().preparing.has(profileId) || get().cancelling.has(profileId)) return;
      const attempt = attempts.get(profileId);
      set((state) => ({ cancelling: withId(state.cancelling, profileId, true) }));

      // Asked until something stops, for as long as this launch is still going.
      // `false` means main had no job registered for the profile at that
      // instant — it is between two of them, not finished — and taking the
      // first answer as final is how Cancel used to free the button while the
      // launch carried on and started the game anyway.
      //
      // Nothing is freed here. Main resolves the launch call once the abort
      // has gone through, and it is `launch` settling that clears `preparing`
      // and `cancelling` both: until then main would refuse a second launch.
      while (get().preparing.has(profileId) && attempts.get(profileId) === attempt) {
        const result = await api.game.cancel(profileId);
        if (result.success && result.data) return;
        await new Promise((resolve) => setTimeout(resolve, CANCEL_RETRY_MS));
      }
    },

    /**
     * `killGame` — SIGTERM, then SIGKILL after ten seconds — does not report
     * success until the process has actually gone. The running state is not
     * cleared here; the process's own `exit` handler sends `game:exited`, which
     * is the one event that means it really stopped.
     */
    stop: async (profileId) => {
      get().clearFailure(profileId);
      set((state) => ({ stopping: withId(state.stopping, profileId, true) }));
      try {
        const result = await api.game.kill(profileId);
        if (!result.success) fail(profileId, { kind: 'stop-failed', error: result.error });
      } finally {
        set((state) => ({ stopping: withId(state.stopping, profileId, false) }));
      }
    },

    clearFailure: (profileId) => {
      set((state) => {
        if (!(profileId in state.failures)) return state;
        const next = { ...state.failures };
        delete next[profileId];
        return { failures: next };
      });
    },

    isConsoleVisible: (profileId) => get().consoleVisible.has(profileId),

    toggleConsole: (profileId, visible) => {
      set((state) => {
        const next = new Set(state.consoleVisible);
        if (visible) next.add(profileId);
        else next.delete(profileId);
        return { consoleVisible: next };
      });
    },
  };
});
