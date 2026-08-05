import type { z } from 'zod';
import type { NewsItem, Announcement } from '../../shared/ipc-types';
import { newsItemSchema, announcementSchema } from '../../shared/validators';
import { getSettings } from '../config/settings-manager';
import { MODRINTH_USER_AGENT } from '../../shared/constants';
import { log } from '../../main/logger';

/**
 * A cached feed, tagged with the URL it came from.
 *
 * The tag is what makes "configure a feed URL, see the feed" work. Keying the
 * cache on nothing meant the placeholders fetched at startup — when no URL was
 * set — stayed cached, so a URL entered afterwards did nothing until restart.
 */
interface FeedCache<T> {
  /** Empty string means no feed is configured, so nothing was fetched. */
  source: string;
  items: T[];
}

let newsCache: FeedCache<NewsItem> | null = null;
let announcementsCache: FeedCache<Announcement> | null = null;

const FETCH_TIMEOUT_MS = 10_000;

/**
 * Fetch and validate a remote feed.
 *
 * A feed is untrusted input from a URL the user pasted, so every item is
 * validated individually: one malformed entry drops that entry rather than the
 * whole feed. Returns `null` on any failure — the caller decides what a failed
 * fetch should show.
 */
async function fetchFeed<T>(url: string, schema: z.ZodType<T>, label: string): Promise<T[] | null> {
  if (!/^https?:\/\//i.test(url)) {
    log.warn(`${label} feed URL must be http(s): ${url}`);
    return null;
  }

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': MODRINTH_USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      log.warn(`${label} feed returned ${response.status}`);
      return null;
    }

    const raw: unknown = await response.json();
    if (!Array.isArray(raw)) {
      log.warn(`${label} feed is not a JSON array`);
      return null;
    }

    const valid: T[] = [];
    let dropped = 0;
    for (const entry of raw) {
      const parsed = schema.safeParse(entry);
      if (parsed.success) valid.push(parsed.data);
      else dropped++;
    }

    if (dropped > 0) {
      log.warn(`${label} feed: dropped ${dropped} malformed of ${raw.length} entries`);
    }
    return valid;
  } catch (err) {
    log.warn(`Failed to fetch ${label} feed:`, err);
    return null;
  }
}

/**
 * Resolve a feed, reusing the cache only when it belongs to the same URL.
 *
 * Every outcome that is not a successful fetch shows the last good result for
 * that URL, or an empty section. There is deliberately no placeholder copy to
 * fall back to: presenting demo text as the server's announcements is worse
 * than showing nothing, and an emptied feed URL is a decision, not a gap to
 * fill in. A fresh install has White Ravens' feeds set (see `branding.ts`), so
 * the no-URL case only arises when somebody cleared the field on purpose.
 */
async function loadFeed<T>(
  cache: FeedCache<T> | null,
  url: string | undefined,
  schema: z.ZodType<T>,
  label: string,
  forceRefresh: boolean,
): Promise<FeedCache<T>> {
  if (!url) return { source: '', items: [] };
  if (cache?.source === url && !forceRefresh) return cache;

  const fetched = await fetchFeed(url, schema, label);
  if (fetched) return { source: url, items: fetched };
  return cache?.source === url ? cache : { source: url, items: [] };
}

/** News for the home page. */
export async function fetchNews(forceRefresh = false): Promise<NewsItem[]> {
  const { newsFeedUrl } = await getSettings();
  newsCache = await loadFeed(newsCache, newsFeedUrl, newsItemSchema, 'News', forceRefresh);
  return newsCache.items;
}

/** Same contract as {@link fetchNews}, for the banner strip. */
export async function fetchAnnouncements(forceRefresh = false): Promise<Announcement[]> {
  const { announcementFeedUrl } = await getSettings();
  announcementsCache = await loadFeed(
    announcementsCache,
    announcementFeedUrl,
    announcementSchema,
    'Announcements',
    forceRefresh,
  );
  return announcementsCache.items;
}
