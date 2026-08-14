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

/**
 * A feed, plus whether the last attempt to fetch it worked.
 *
 * The two travel together because a bare array cannot tell an unreachable feed
 * apart from a publisher with nothing to say. That ambiguity was the bug: a
 * typo'd or dead URL left the previously loaded articles sitting on the home
 * page indefinitely, with no hint that they had stopped being current.
 *
 * `failed` is a flag rather than a message on purpose — `src/core/` has no
 * locale and no business having one, so the renderer picks the wording. See
 * {@link ProgressKey} for the same rule applied to progress lines.
 */
export interface FeedResult<T> {
  /**
   * What to show. On a failure these are the last good items for that same URL,
   * or nothing if the URL has changed or never succeeded — the previous URL's
   * articles are never presented as the new one's.
   */
  items: T[];
  failed: boolean;
}
