import { create } from 'zustand';
import type { NewsItem, Announcement } from '@shared/ipc-types';

const api = window.ravenforge;

interface NewsStore {
  news: NewsItem[];
  announcements: Announcement[];
  dismissedIds: Set<string>;
  loading: boolean;

  load: () => Promise<void>;
  refresh: () => Promise<void>;
  dismiss: (id: string) => void;
}

export const useNewsStore = create<NewsStore>((set, get) => ({
  news: [],
  announcements: [],
  dismissedIds: new Set(
    JSON.parse(localStorage.getItem('rf-dismissed-announcements') ?? '[]') as string[],
  ),
  loading: false,

  load: async () => {
    set({ loading: true });
    const [newsRes, annRes] = await Promise.all([api.news.get(), api.announcements.get()]);
    set({
      news: newsRes.success && newsRes.data ? newsRes.data : [],
      announcements: annRes.success && annRes.data ? annRes.data : [],
      loading: false,
    });
  },

  // Both feeds, not just news. They are configured together and shown on the
  // same screen, so "refresh" that quietly left the announcement banners stale
  // was only half a button.
  refresh: async () => {
    set({ loading: true });
    const [newsRes, annRes] = await Promise.all([api.news.refresh(), api.announcements.refresh()]);
    set({
      ...(newsRes.success && newsRes.data ? { news: newsRes.data } : {}),
      ...(annRes.success && annRes.data ? { announcements: annRes.data } : {}),
      loading: false,
    });
  },

  dismiss: (id) => {
    const dismissed = new Set(get().dismissedIds);
    dismissed.add(id);
    set({ dismissedIds: dismissed });
    localStorage.setItem('rf-dismissed-announcements', JSON.stringify([...dismissed]));
  },
}));
