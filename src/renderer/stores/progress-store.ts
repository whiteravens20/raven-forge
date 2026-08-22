import { create } from 'zustand';
import type { ProgressEvent } from '@shared/ipc-types';

const api = window.ravenforge;

type Channel =
  | 'progress:mod-sync'
  | 'progress:loader-install'
  | 'progress:java-download'
  | 'progress:game-assets'
  | 'progress:launcher-update';

interface ProgressEntry extends ProgressEvent {
  channel: Channel;
  /**
   * Which update this entry is, counted rather than timed.
   *
   * A clock would do for showing staleness and not for the delayed clear below,
   * which has to ask "is this still the entry I was set for" — and two updates
   * within the same millisecond are ordinary when the answer decides whether a
   * live progress bar is deleted.
   */
  stamp: number;
}

let stamps = 0;

interface ProgressStore {
  entries: Map<string, ProgressEntry>;
  /** Visible to consumers — true while at least one entry is in-flight. */
  hasActive: boolean;
  init: () => void;
  clear: (operationId: string) => void;
}

const CHANNELS: Channel[] = [
  'progress:mod-sync',
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
          const stamp = ++stamps;
          next.set(event.operationId, { ...event, channel, stamp });
          set({ entries: next, hasActive: hasInflight(next) });
          setTimeout(() => {
            const after = new Map(get().entries);
            // Only if it is still the entry this timeout was set for. Operation
            // ids are deterministic and reused — `java-21`, `assets-<version>`,
            // the profile id itself — so relaunching within the hold used to
            // have the first launch's timeout delete the second launch's live
            // progress, leaving the overlay blank while work carried on.
            if (after.get(event.operationId)?.stamp !== stamp) return;
            after.delete(event.operationId);
            set({ entries: after, hasActive: hasInflight(after) });
          }, 1500);
        } else {
          next.set(event.operationId, { ...event, channel, stamp: ++stamps });
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
