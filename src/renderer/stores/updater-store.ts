import { create } from 'zustand';
import type { UpdateInfo } from '@shared/ipc-types';

const api = window.ravenforge;

/**
 * Whether a launcher update is waiting, and how far along it is.
 *
 * Fed by the events the main process already emits from its startup check, so
 * the Play button can consult this without adding a network round-trip to every
 * click. A launch must never wait on a network call that might hang.
 */
export type UpdateStage = 'idle' | 'downloading' | 'ready' | 'failed';

interface UpdaterStore {
  available: UpdateInfo | null;
  stage: UpdateStage;
  error: string | null;

  /** Download the pending update. Resolves true once it is ready to install. */
  downloadPending: () => Promise<boolean>;
  install: () => Promise<void>;
  dismiss: () => void;
}

export const useUpdaterStore = create<UpdaterStore>((set, get) => ({
  available: null,
  stage: 'idle',
  error: null,

  downloadPending: async () => {
    if (!get().available) return false;
    if (get().stage === 'ready') return true;

    set({ stage: 'downloading', error: null });
    const result = await api.updater.download();
    if (!result.success) {
      set({ stage: 'failed', error: result.error ?? 'Update download failed' });
      return false;
    }
    // `update-downloaded` also sets this; setting it here too means a caller
    // awaiting this promise does not race the event.
    set({ stage: 'ready' });
    return true;
  },

  install: async () => {
    await api.updater.install();
  },

  /** Give up on this update for the rest of the session. */
  dismiss: () => set({ available: null, stage: 'idle', error: null }),
}));

// Subscribed once at module load, like the other stores: these events can fire
// from the startup check before any component that cares has mounted.
api.on('updater:update-available', (info) => {
  useUpdaterStore.setState({ available: info, stage: 'idle' });
});

api.on('updater:update-downloaded', (info) => {
  useUpdaterStore.setState({ available: info, stage: 'ready' });
});
