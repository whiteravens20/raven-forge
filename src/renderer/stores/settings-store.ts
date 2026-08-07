import { create } from 'zustand';
import type { GlobalSettings } from '@shared/ipc-types';

const api = window.ravenforge;

interface SettingsStore {
  settings: GlobalSettings | null;
  loading: boolean;

  load: () => Promise<void>;
  /**
   * `false` when the main process rejected the change — a value the settings
   * schema does not accept. The caller has to be told: the store keeps the old
   * settings, so a controlled input silently snaps back to them otherwise.
   */
  update: (updates: Partial<GlobalSettings>) => Promise<boolean>;
  reset: () => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set, _get) => ({
  settings: null,
  loading: false,

  load: async () => {
    set({ loading: true });
    const result = await api.settings.get();
    if (result.success && result.data) {
      set({ settings: result.data, loading: false });
      // Apply theme
      document.documentElement.setAttribute('data-theme', result.data.theme);
    } else {
      set({ loading: false });
    }
  },

  update: async (updates) => {
    const result = await api.settings.update(updates);
    if (!result.success || !result.data) return false;
    set({ settings: result.data });
    document.documentElement.setAttribute('data-theme', result.data.theme);
    return true;
  },

  reset: async () => {
    const result = await api.settings.reset();
    if (result.success && result.data) {
      set({ settings: result.data });
      document.documentElement.setAttribute('data-theme', result.data.theme);
    }
  },
}));
