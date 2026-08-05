import { create } from 'zustand';
import type { GameExitInfo } from '@shared/ipc-types';
import { useProfileStore } from './profile-store';

const api = window.ravenforge;

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
  /** Most recent crash info per profile */
  crashInfo: Record<string, GameExitInfo>;
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
  isConsoleVisible: (profileId: string) => boolean;
  toggleConsole: (profileId: string, visible: boolean) => void;
}

export const useGameStore = create<GameStore>((set, get) => {
  // Subscribe to game events once
  let subscribed = false;
  if (!subscribed) {
    api.on('game:started', (pid) => {
      get().addRunning(pid);
    });
    api.on('game:exited', (info) => {
      get().removeRunning(info.profileId, info);
      // Main has just folded this session into the profile's play stats; re-read
      // so "last played" and the hour count update without a navigation.
      void useProfileStore.getState().load();
    });
    subscribed = true;
  }

  return {
    running: new Set(),
    preparing: new Set(),
    crashInfo: {},
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
