import { create } from 'zustand';
import type { ProgressEvent } from '@shared/ipc-types';

const api = window.ravenforge;

type Channel =
  | 'progress:mod-sync'
  | 'progress:mod-download'
  | 'progress:loader-install'
  | 'progress:java-download'
  | 'progress:game-assets'
  | 'progress:launcher-update';

interface ProgressEntry extends ProgressEvent {
  channel: Channel;
  /** Wallclock time of last update, used to auto-clear stale entries. */
  updatedAt: number;
}

interface ProgressStore {
  entries: Map<string, ProgressEntry>;
  /** Visible to consumers — true while at least one entry is in-flight. */
  hasActive: boolean;
  init: () => void;
  clear: (operationId: string) => void;
}

const CHANNELS: Channel[] = [
  'progress:mod-sync',
  'progress:mod-download',
  'progress:loader-install',
  'progress:java-download',
  'progress:game-assets',
  'progress:launcher-update',
];

let initialized = false;

export const useProgressStore = create<ProgressStore>((set, get) => ({
  entries: new Map(),
  hasActive: false,

  init: () => {
    if (initialized) return;
    initialized = true;
    for (const channel of CHANNELS) {
      const handler = (event: ProgressEvent) => {
        const next = new Map(get().entries);
        if (event.progress >= 1) {
          // Auto-remove completed entries after a short hold
          next.set(event.operationId, { ...event, channel, updatedAt: Date.now() });
          set({ entries: next, hasActive: hasInflight(next) });
          setTimeout(() => {
            const after = new Map(get().entries);
            after.delete(event.operationId);
            set({ entries: after, hasActive: hasInflight(after) });
          }, 1500);
        } else {
          next.set(event.operationId, { ...event, channel, updatedAt: Date.now() });
          set({ entries: next, hasActive: true });
        }
      };
      api.on(channel, handler);
    }
  },

  clear: (operationId) => {
    const next = new Map(get().entries);
    next.delete(operationId);
    set({ entries: next, hasActive: hasInflight(next) });
  },
}));

function hasInflight(entries: Map<string, ProgressEntry>): boolean {
  for (const e of entries.values()) {
    if (e.progress < 1) return true;
  }
  return false;
}
