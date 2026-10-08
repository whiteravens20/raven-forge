// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { create } from 'zustand';

/**
 * Something that went wrong and has no place of its own to be said.
 *
 * A button that opens a link or a folder belongs to whichever page it is on,
 * and none of those pages had anywhere to report that nothing opened — so
 * a dozen of them said nothing at all. One line for the whole window, shown
 * above every page.
 */
interface NoticeStore {
  message: string | null;
  show: (message: string) => void;
  clear: () => void;
}

export const useNoticeStore = create<NoticeStore>((set) => ({
  message: null,
  show: (message) => set({ message }),
  clear: () => set({ message: null }),
}));
