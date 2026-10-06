// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { create } from 'zustand';
import type { IpcResult, Profile } from '@shared/ipc-types';

const api = window.ravenforge;

interface ProfileStore {
  profiles: Profile[];
  selectedProfileId: string | null;
  loading: boolean;

  load: () => Promise<void>;
  select: (profileId: string | null) => void;
  /**
   * Both answer with what the main process said. It refuses a profile the
   * schema does not accept, and a caller that could not hear that closed its
   * form over a profile that had not been saved.
   */
  create: (data: Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>) => Promise<IpcResult<Profile>>;
  update: (profileId: string, updates: Partial<Profile>) => Promise<IpcResult<Profile>>;
  /**
   * `deleteFiles: false` unlists the profile but leaves its directory intact.
   * Answers with the main process's reply: a delete can be refused, and one
   * that could not remove every file says so.
   */
  remove: (profileId: string, deleteFiles: boolean) => Promise<IpcResult<void>>;
  /** Profiles being deleted right now. A profile with worlds in it takes a while to go. */
  removing: Set<string>;
  /**
   * Profiles being copied right now, by the id of the original.
   *
   * Kept here and not in the page, because a copy carries the profile's mods
   * and takes as long as they do: leaving the page and coming back used to find
   * the button idle again, and a second press made a second copy.
   */
  duplicating: Set<string>;
  duplicate: (profileId: string, name?: string) => Promise<IpcResult<Profile>>;
}

/** Where the last selected profile is kept between runs — the page's own storage. */
const SELECTION_KEY = 'rf-selected-profile';

function recallSelection(): string | null {
  try {
    return localStorage.getItem(SELECTION_KEY);
  } catch {
    return null;
  }
}

function rememberSelection(profileId: string): void {
  try {
    localStorage.setItem(SELECTION_KEY, profileId);
  } catch {
    /* storage switched off — the selection simply is not remembered */
  }
}

export const useProfileStore = create<ProfileStore>((set, get) => ({
  profiles: [],
  selectedProfileId: null,
  loading: false,
  duplicating: new Set(),
  removing: new Set(),

  load: async () => {
    set({ loading: true });
    const result = await api.profiles.getAll();
    if (result.success && result.data) {
      const profiles = result.data;
      set({ profiles, loading: false });
      // The one that was selected last time, when it is still there; the first
      // otherwise. The launcher used to open on the first profile whatever had
      // been played the night before.
      if (!get().selectedProfileId && profiles.length > 0) {
        const remembered = recallSelection();
        const selected = profiles.find((p) => p.id === remembered) ?? profiles[0];
        set({ selectedProfileId: selected.id });
      }
    } else {
      set({ loading: false });
    }
  },

  select: (profileId) => set({ selectedProfileId: profileId }),

  create: async (data) => {
    const result = await api.profiles.create(data);
    if (result.success && result.data) {
      await get().load();
      set({ selectedProfileId: result.data.id });
    }
    return result;
  },

  update: async (profileId, updates) => {
    const result = await api.profiles.update(profileId, updates);
    await get().load();
    return result;
  },

  remove: async (profileId, deleteFiles) => {
    set((state) => ({ removing: new Set(state.removing).add(profileId) }));
    try {
      const result = await api.profiles.delete(profileId, deleteFiles);
      // Reloaded whatever the answer: a delete that could not remove every file
      // has still taken the profile off the list.
      await get().load();
      const { profiles, selectedProfileId } = get();
      if (selectedProfileId === profileId && !profiles.some((p) => p.id === profileId)) {
        set({ selectedProfileId: profiles[0]?.id ?? null });
      }
      return result;
    } finally {
      set((state) => {
        const next = new Set(state.removing);
        next.delete(profileId);
        return { removing: next };
      });
    }
  },

  duplicate: async (profileId, name) => {
    set((state) => ({ duplicating: new Set(state.duplicating).add(profileId) }));
    try {
      const result = await api.profiles.duplicate(profileId, name);
      if (result.success && result.data) {
        await get().load();
        set({ selectedProfileId: result.data.id });
      }
      return result;
    } finally {
      set((state) => {
        const next = new Set(state.duplicating);
        next.delete(profileId);
        return { duplicating: next };
      });
    }
  },
}));

// Whichever way the selection changes — a click, a new profile, a deletion.
useProfileStore.subscribe((state, before) => {
  if (state.selectedProfileId && state.selectedProfileId !== before.selectedProfileId) {
    rememberSelection(state.selectedProfileId);
  }
});
