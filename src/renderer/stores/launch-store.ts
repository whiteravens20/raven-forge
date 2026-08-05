import { create } from 'zustand';

interface LaunchStore {
  /** Profile IDs currently launching or running */
  runningProfiles: Set<string>;
  /** Profile → launch progress message */
  launchStatus: Record<string, string>;

  setRunning: (profileId: string, running: boolean) => void;
  setStatus: (profileId: string, status: string) => void;
  clearStatus: (profileId: string) => void;
  isRunning: (profileId: string) => boolean;
}

export const useLaunchStore = create<LaunchStore>((set, get) => ({
  runningProfiles: new Set(),
  launchStatus: {},

  setRunning: (profileId, running) => {
    const next = new Set(get().runningProfiles);
    if (running) next.add(profileId);
    else next.delete(profileId);
    set({ runningProfiles: next });
  },

  setStatus: (profileId, status) => {
    set({ launchStatus: { ...get().launchStatus, [profileId]: status } });
  },

  clearStatus: (profileId) => {
    const { [profileId]: _, ...rest } = get().launchStatus;
    set({ launchStatus: rest });
  },

  isRunning: (profileId) => get().runningProfiles.has(profileId),
}));
