import type { z } from 'zod';
import type { NewsItem, Announcement, FeedResult } from '../../shared/ipc-types';
import { newsItemSchema, announcementSchema } from '../../shared/validators';
import { getSettings } from '../config/settings-manager';
import { modrinthUserAgent } from '../net/user-agent';
import { readJsonCapped } from '../net/json';
import { log } from '../../main/logger';

/**
 * A cached feed, tagged with the URL it came from.
 *
 * The tag is what makes "configure a feed URL, see the feed" work. Keying the
 * cache on nothing meant the placeholders fetched at startup — when no URL was
 * set — stayed cached, so a URL entered afterwards did nothing until restart.
 */
interface FeedCache<T> extends FeedResult<T> {
  /** Empty string means no feed is configured, so nothing was fetched. */
  source: string;
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
 *
 * `revalidate` is what makes the refresh button mean something. GitHub Pages
 * serves these feeds with `Cache-Control: max-age=600`, so without it a press
 * inside ten minutes is answered from the HTTP cache and the freshly published
 * item does not appear — a button that looks like it worked and did nothing.
 */
async function fetchFeed<T>(
  url: string,
  schema: z.ZodType<T>,
  label: string,
  revalidate: boolean,
): Promise<T[] | null> {
  if (!/^https?:\/\//i.test(url)) {
    log.warn(`${label} feed URL must be http(s): ${url}`);
    return null;
  }

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': modrinthUserAgent() },
      cache: revalidate ? 'no-cache' : 'default',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      log.warn(`${label} feed returned ${response.status}`);
      return null;
    }

    const raw = await readJsonCapped(response, `The ${label.toLowerCase()} feed`);
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
 * A failed fetch keeps the last good result for that URL and says so, rather
 * than passing stale articles off as current — that silence is what let a dead
 * feed sit on the home page looking like a quiet week. There is deliberately no
 * placeholder copy to fall back to: presenting demo text as the server's
 * announcements is worse than showing nothing, and an emptied feed URL is a
 * decision, not a gap to fill in. A fresh install has White Ravens' feeds set
 * (see `branding.ts`), so the no-URL case only arises when somebody cleared the
 * field on purpose.
 *
 * A cached *failure* is never served: an unforced call retries, so a feed that
 * was down at startup is not written off for the rest of the session.
 */
async function loadFeed<T>(
  cache: FeedCache<T> | null,
  url: string | undefined,
  schema: z.ZodType<T>,
  label: string,
  forceRefresh: boolean,
): Promise<FeedCache<T>> {
  if (!url) return { source: '', items: [], failed: false };
  if (cache?.source === url && !cache.failed && !forceRefresh) return cache;

  const fetched = await fetchFeed(url, schema, label, forceRefresh);
  if (fetched) return { source: url, items: fetched, failed: false };

  // Same URL: keep what it last gave us. Different URL: nothing, because the
  // previous feed's articles are not this one's.
  return { source: url, items: cache?.source === url ? cache.items : [], failed: true };
}

/** News for the home page. */
export async function fetchNews(forceRefresh = false): Promise<FeedResult<NewsItem>> {
  const { newsFeedUrl } = await getSettings();
  newsCache = await loadFeed(newsCache, newsFeedUrl, newsItemSchema, 'News', forceRefresh);
  return { items: newsCache.items, failed: newsCache.failed };
}

/** Same contract as {@link fetchNews}, for the banner strip. */
export async function fetchAnnouncements(forceRefresh = false): Promise<FeedResult<Announcement>> {
  const { announcementFeedUrl } = await getSettings();
  announcementsCache = await loadFeed(
    announcementsCache,
    announcementFeedUrl,
    announcementSchema,
    'Announcements',
    forceRefresh,
  );
  return { items: announcementsCache.items, failed: announcementsCache.failed };
}
