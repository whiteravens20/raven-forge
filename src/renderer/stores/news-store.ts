import { create } from 'zustand';
import type { NewsItem, Announcement, FeedResult, IpcResult } from '@shared/ipc-types';

const api = window.ravenforge;

interface NewsStore {
  news: NewsItem[];
  announcements: Announcement[];
  dismissedIds: Set<string>;
  loading: boolean;
  /**
   * Set when the last attempt at either feed failed.
   *
   * One flag for both because one button refreshes both, and that button is
   * where the page reports it. Whichever half failed, something the user asked
   * for did not happen, and saying nothing is how a dead feed URL used to pass
   * for a slow news week.
   */
  feedError: boolean;

  load: () => Promise<void>;
  refresh: () => Promise<void>;
  dismiss: (id: string) => void;
}

/** A dead channel and a dead feed are the same news to the page. */
function failed<T>(res: IpcResult<FeedResult<T>>): boolean {
  return !res.success || (res.data?.failed ?? true);
}

export const useNewsStore = create<NewsStore>((set, get) => ({
  news: [],
  announcements: [],
  dismissedIds: new Set(
    JSON.parse(localStorage.getItem('rf-dismissed-announcements') ?? '[]') as string[],
  ),
  loading: false,
  feedError: false,

  load: async () => {
    set({ loading: true });
    const [newsRes, annRes] = await Promise.all([api.news.get(), api.announcements.get()]);
    set({
      news: newsRes.data?.items ?? [],
      announcements: annRes.data?.items ?? [],
      feedError: failed(newsRes) || failed(annRes),
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
      // A failed fetch still carries the last good items, so this assigns rather
      // than preserves. The guard is for the call itself failing, which carries
      // nothing at all — and then what is on screen is the best we have.
      ...(newsRes.data ? { news: newsRes.data.items } : {}),
      ...(annRes.data ? { announcements: annRes.data.items } : {}),
      feedError: failed(newsRes) || failed(annRes),
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
