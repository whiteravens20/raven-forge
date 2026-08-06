// The two remote feeds the home page shows.
// Part of the IPC contract — see `../ipc-types.ts`.

export interface NewsItem {
  id: string;
  title: string;
  excerpt: string;
  /**
   * Full text, in the small Markdown subset `parseArticle` understands.
   * The launcher reads this itself; `url` is only ever an extra way out.
   */
  body?: string;
  /** Optional — a feed with no website behind it is a supported feed. */
  url?: string;
  imageUrl?: string;
  publishedAt: string;
}

export interface Announcement {
  id: string;
  message: string;
  type: 'info' | 'warning' | 'urgent';
  /** Heading for the reader; the banner still shows `message`. */
  title?: string;
  /** Full text, same subset as {@link NewsItem.body}. */
  body?: string;
  url?: string;
  dismissible: boolean;
}
