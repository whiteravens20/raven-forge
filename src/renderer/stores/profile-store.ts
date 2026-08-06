import { create } from 'zustand';
import type { Profile } from '@shared/ipc-types';

const api = window.ravenforge;

interface ProfileStore {
  profiles: Profile[];
  selectedProfileId: string | null;
  loading: boolean;

  load: () => Promise<void>;
  select: (profileId: string | null) => void;
  create: (data: Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Profile | null>;
  update: (profileId: string, updates: Partial<Profile>) => Promise<void>;
  /** `deleteFiles: false` unlists the profile but leaves its directory intact. */
  remove: (profileId: string, deleteFiles: boolean) => Promise<void>;
  duplicate: (profileId: string, name?: string) => Promise<void>;
}

export const useProfileStore = create<ProfileStore>((set, get) => ({
  profiles: [],
  selectedProfileId: null,
  loading: false,

  load: async () => {
    set({ loading: true });
    const result = await api.profiles.getAll();
    if (result.success && result.data) {
      const profiles = result.data;
      set({ profiles, loading: false });
      // Auto-select first if none selected
      if (!get().selectedProfileId && profiles.length > 0) {
        set({ selectedProfileId: profiles[0].id });
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
      return result.data;
    }
    return null;
  },

  update: async (profileId, updates) => {
    await api.profiles.update(profileId, updates);
    await get().load();
  },

  remove: async (profileId, deleteFiles) => {
    await api.profiles.delete(profileId, deleteFiles);
    const { profiles, selectedProfileId } = get();
    if (selectedProfileId === profileId) {
      const remaining = profiles.filter((p) => p.id !== profileId);
      set({ selectedProfileId: remaining[0]?.id ?? null });
    }
    await get().load();
  },

  duplicate: async (profileId, name) => {
    const result = await api.profiles.duplicate(profileId, name);
    if (result.success && result.data) {
      await get().load();
      set({ selectedProfileId: result.data.id });
    }
  },
}));
