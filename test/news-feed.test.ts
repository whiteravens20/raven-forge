import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GlobalSettings } from '../src/shared/ipc-types';

const settings: Partial<GlobalSettings> = {};

vi.mock('../src/core/config/settings-manager', () => ({
  getSettings: () => Promise.resolve(settings),
}));

const { fetchNews, fetchAnnouncements } = await import('../src/core/news/news-fetcher');

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const item = (id: string) => ({
  id,
  title: `Title ${id}`,
  excerpt: 'x',
  publishedAt: '2026-08-05T00:00:00Z',
});

const announcement = (id: string) => ({ id, message: 'm', type: 'info', dismissible: true });

let fetchMock: ReturnType<typeof vi.fn>;

// The fetcher's cache is module-level and outlives a single test, which is the
// point of it — so each test gets URLs nothing has cached yet.
let urlCounter = 0;
const freshUrl = () => `https://feed${++urlCounter}.example/feed.json`;

beforeEach(() => {
  delete settings.newsFeedUrl;
  delete settings.announcementFeedUrl;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The cache is keyed on the URL it was filled from.
 *
 * Keying it on nothing is what produced the bug this covers: the empty result
 * cached at startup — when no feed URL was set — outlived the URL being entered,
 * so a newly configured feed did nothing at all until the launcher restarted.
 */
describe('feed caching', () => {
  it('shows nothing and asks for nothing when the URL has been cleared', async () => {
    // A fresh install has White Ravens' feed set, so this is somebody who
    // emptied the field — a decision, not a state to paper over.
    settings.newsFeedUrl = '';
    expect(await fetchNews()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches as soon as a URL appears, without a restart', async () => {
    await fetchNews(); // caches the empty result
    settings.newsFeedUrl = freshUrl();
    fetchMock.mockResolvedValue(jsonResponse([item('live')]));

    const news = await fetchNews();
    expect(news.map((n) => n.id)).toEqual(['live']);
  });

  it('serves the cache on a second call to the same URL', async () => {
    settings.newsFeedUrl = freshUrl();
    fetchMock.mockResolvedValue(jsonResponse([item('a')]));

    await fetchNews();
    await fetchNews();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetches when asked to force, same URL or not', async () => {
    settings.newsFeedUrl = freshUrl();
    fetchMock.mockResolvedValue(jsonResponse([item('a')]));
    await fetchNews();

    fetchMock.mockResolvedValue(jsonResponse([item('b')]));
    expect((await fetchNews(true)).map((n) => n.id)).toEqual(['b']);
  });

  it('makes a forced refresh revalidate rather than accept a cached body', async () => {
    // The feeds ship on GitHub Pages behind `max-age=600`, so without this the
    // refresh button is answered from cache for ten minutes and appears to have
    // done nothing.
    settings.newsFeedUrl = freshUrl();
    fetchMock.mockResolvedValue(jsonResponse([item('a')]));

    await fetchNews();
    expect(fetchMock.mock.calls[0][1].cache).toBe('default');

    await fetchNews(true);
    expect(fetchMock.mock.calls[1][1].cache).toBe('no-cache');
  });

  it('refetches when the URL changes, even without a force', async () => {
    settings.newsFeedUrl = freshUrl();
    fetchMock.mockResolvedValue(jsonResponse([item('one')]));
    await fetchNews();

    settings.newsFeedUrl = freshUrl();
    fetchMock.mockResolvedValue(jsonResponse([item('two')]));
    expect((await fetchNews()).map((n) => n.id)).toEqual(['two']);
  });

  it('keeps the last good result when a refresh fails', async () => {
    settings.newsFeedUrl = freshUrl();
    fetchMock.mockResolvedValue(jsonResponse([item('good')]));
    await fetchNews();

    fetchMock.mockResolvedValue(jsonResponse(null, false, 503));
    expect((await fetchNews(true)).map((n) => n.id)).toEqual(['good']);
  });

  it('shows an empty section rather than anything invented when the first fetch fails', async () => {
    settings.newsFeedUrl = freshUrl();
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await fetchNews()).toEqual([]);
  });

  it('drops a malformed entry rather than the whole feed', async () => {
    settings.newsFeedUrl = freshUrl();
    fetchMock.mockResolvedValue(jsonResponse([item('ok'), { id: 'bad' }]));
    expect((await fetchNews()).map((n) => n.id)).toEqual(['ok']);
  });

  it('refuses a non-http(s) feed URL without calling fetch', async () => {
    settings.newsFeedUrl = 'file:///etc/passwd';
    expect(await fetchNews()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives announcements the same treatment — the bug was only ever on this side', async () => {
    await fetchAnnouncements(); // caches the empty result
    settings.announcementFeedUrl = freshUrl();
    fetchMock.mockResolvedValue(jsonResponse([announcement('live')]));

    expect((await fetchAnnouncements()).map((a) => a.id)).toEqual(['live']);
  });

  it('refreshes announcements on demand', async () => {
    settings.announcementFeedUrl = freshUrl();
    fetchMock.mockResolvedValue(jsonResponse([announcement('a')]));
    await fetchAnnouncements();

    fetchMock.mockResolvedValue(jsonResponse([announcement('b')]));
    expect((await fetchAnnouncements(true)).map((a) => a.id)).toEqual(['b']);
  });
});
