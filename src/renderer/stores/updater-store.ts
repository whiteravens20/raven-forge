// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { create } from 'zustand';
import type { UpdateInfo } from '@shared/ipc-types';

const api = window.ravenforge;

/**
 * Whether a launcher update is waiting, and how far along it is.
 *
 * The one place that knows. The toast, the Play button and the Settings page
 * each used to keep their own account of this, fed by the same events, and the
 * three disagreed: "Later" hid the toast and Play then installed the update
 * anyway; a check from Settings put a finished download back to "Download".
 *
 * Fed by the events the main process already emits from its startup check, so
 * the Play button can consult this without adding a network round-trip to every
 * click. A launch must never wait on a network call that might hang.
 */
type UpdateStage = 'idle' | 'downloading' | 'ready' | 'failed';

interface UpdaterStore {
  available: UpdateInfo | null;
  stage: UpdateStage;
  /** How much of the download has arrived, 0 to 100. */
  percent: number;
  error: string | null;
  /**
   * "Later". For the rest of this session the update is not announced and
   * pressing Play does not install it; the next start offers it again.
   */
  postponed: boolean;

  /** Download the pending update. Resolves true once it is ready to install. */
  download: () => Promise<boolean>;
  /** Restart into the update. Resolves false, with `error` set, when that failed. */
  install: () => Promise<boolean>;
  postpone: () => void;
}

/** The download under way, so that a second request for it joins the first. */
let downloading: Promise<boolean> | null = null;

export const useUpdaterStore = create<UpdaterStore>((set, get) => ({
  available: null,
  stage: 'idle',
  percent: 0,
  error: null,
  postponed: false,

  download: () => {
    if (!get().available) return Promise.resolve(false);
    if (get().stage === 'ready') return Promise.resolve(true);
    if (downloading) return downloading;

    set({ stage: 'downloading', percent: 0, error: null });
    downloading = api.updater
      .download()
      .then((result) => {
        if (!result.success) {
          set({ stage: 'failed', error: result.error ?? null });
          return false;
        }
        // `update-downloaded` also sets this; setting it here too means a caller
        // awaiting this promise does not race the event.
        set({ stage: 'ready', percent: 100 });
        return true;
      })
      .finally(() => {
        downloading = null;
      });
    return downloading;
  },

  install: async () => {
    const result = await api.updater.install();
    // Success quits the launcher, so only a failure ever gets here.
    if (!result.success) set({ error: result.error ?? null });
    return result.success;
  },

  postpone: () =>
    set((state) => ({
      postponed: true,
      // A download that failed is not held against the next attempt.
      stage: state.stage === 'failed' ? 'idle' : state.stage,
      error: null,
    })),
}));

// Subscribed once at module load, like the other stores: these events can fire
// from the startup check before any component that cares has mounted.
api.on('updater:update-available', (info) => {
  const { available, stage } = useUpdaterStore.getState();
  // Said again by every check. For the version already known it is no news: a
  // download in progress or finished stays as it is, and so does "Later".
  if (available?.version === info.version && stage !== 'failed') {
    useUpdaterStore.setState({ available: info });
    return;
  }
  useUpdaterStore.setState({
    available: info,
    stage: 'idle',
    percent: 0,
    error: null,
    postponed: available?.version === info.version && useUpdaterStore.getState().postponed,
  });
});

api.on('updater:update-downloaded', (info) => {
  useUpdaterStore.setState({ available: info, stage: 'ready', percent: 100 });
});

api.on('progress:launcher-update', (event) => {
  useUpdaterStore.setState({ percent: Math.round(event.progress * 100) });
});
