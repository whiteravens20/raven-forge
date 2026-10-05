// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

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
  /**
   * How the last press of the refresh button ended, or null before the first.
   *
   * The button used to change nothing on screen at all when the feed had not
   * moved, which is the usual case — so a press that worked and a press that
   * did nothing looked the same. `added` counts entries that were not there
   * before, across both feeds.
   */
  lastRefresh: { at: number; added: number } | null;

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
  lastRefresh: null,

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
    // One fetch at a time, and none dropped. Waiting is right for a second
    // press of the button, which would only race the first to the same answer;
    // dropping it is wrong for the other caller, Settings, which refreshes
    // after a feed address changes — a refresh still in flight was asked of the
    // *old* address, so the one behind it is the only one that fetches the new.
    while (inFlight) await inFlight;
    inFlight = runRefresh(set, get).finally(() => {
      inFlight = null;
    });
    await inFlight;
  },

  dismiss: (id) => {
    const dismissed = new Set(get().dismissedIds);
    dismissed.add(id);
    set({ dismissedIds: dismissed });
    localStorage.setItem('rf-dismissed-announcements', JSON.stringify([...dismissed]));
  },
}));

/** The refresh in progress, if there is one. */
let inFlight: Promise<void> | null = null;

async function runRefresh(
  set: (partial: Partial<NewsStore>) => void,
  get: () => NewsStore,
): Promise<void> {
  {
    set({ loading: true });
    // The two feeds number their entries independently, so an id only means
    // something together with the feed it came from.
    const knownNews = new Set(get().news.map((item) => item.id));
    const knownAnnouncements = new Set(get().announcements.map((item) => item.id));
    const [newsRes, annRes] = await Promise.all([api.news.refresh(), api.announcements.refresh()]);
    const added =
      (newsRes.data?.items ?? []).filter((item) => !knownNews.has(item.id)).length +
      (annRes.data?.items ?? []).filter((item) => !knownAnnouncements.has(item.id)).length;
    set({
      // A failed fetch still carries the last good items, so this assigns rather
      // than preserves. The guard is for the call itself failing, which carries
      // nothing at all — and then what is on screen is the best we have.
      ...(newsRes.data ? { news: newsRes.data.items } : {}),
      ...(annRes.data ? { announcements: annRes.data.items } : {}),
      feedError: failed(newsRes) || failed(annRes),
      lastRefresh: { at: Date.now(), added },
      loading: false,
    });
  }
}
