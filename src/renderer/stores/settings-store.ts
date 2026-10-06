// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { create } from 'zustand';
import type { GlobalSettings, TrustedKey } from '@shared/ipc-types';

const api = window.ravenforge;

/**
 * `null` on success, otherwise the main process's reason — empty when it gave
 * none, which the caller puts into words of its own.
 */
type KeyResult = Promise<string | null>;

interface SettingsStore {
  settings: GlobalSettings | null;

  load: () => Promise<void>;
  /**
   * `false` when the main process rejected the change — a value the settings
   * schema does not accept. The caller has to be told: the store keeps the old
   * settings, so a controlled input silently snaps back to them otherwise.
   */
  update: (updates: Partial<GlobalSettings>) => Promise<boolean>;
  /** `false` if the main process refused. */
  reset: () => Promise<boolean>;
  /**
   * The key list has channels of its own, which check what `update` cannot: that
   * a key is a key, and that it is not on the list already. Both answer with the
   * settings as stored, so there is nothing to write back afterwards.
   */
  addTrustedKey: (key: TrustedKey) => KeyResult;
  removeTrustedKey: (publicKey: string) => KeyResult;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: null,

  load: async () => {
    const result = await api.settings.get();
    if (result.success && result.data) {
      set({ settings: result.data });
      // Apply theme
      document.documentElement.setAttribute('data-theme', result.data.theme);
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
    if (!result.success || !result.data) return false;
    set({ settings: result.data });
    document.documentElement.setAttribute('data-theme', result.data.theme);
    return true;
  },

  addTrustedKey: async (key) => {
    const result = await api.settings.addTrustedKey(key);
    if (!result.success || !result.data) return result.error ?? '';
    set({ settings: result.data });
    return null;
  },

  removeTrustedKey: async (publicKey) => {
    const result = await api.settings.removeTrustedKey(publicKey);
    if (!result.success || !result.data) return result.error ?? '';
    set({ settings: result.data });
    return null;
  },
}));
