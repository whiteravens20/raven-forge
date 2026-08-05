import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GlobalSettings } from '../src/shared/ipc-types';

const settings: Partial<GlobalSettings> = {};

vi.mock('../src/core/config/settings-manager', () => ({
  getSettings: () => Promise.resolve(settings),
}));

const { fetchNews, fetchAnnouncements } = await import('../src/core/news/news-fetcher');
const { MOCK_NEWS } = await import('../src/core/news/mock-data');

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
 * Keying it on nothing is what produced the bug this covers: the placeholders
 * cached at startup — when no feed URL was set — outlived the URL being entered,
 * so a newly configured feed did nothing at all until the launcher restarted.
 */
describe('feed caching', () => {
  it('shows placeholders and asks for nothing when no URL is configured', async () => {
    expect(await fetchNews()).toEqual(MOCK_NEWS);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches as soon as a URL appears, without a restart', async () => {
    await fetchNews(); // caches the placeholders
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

  it('never falls back to placeholders once a URL is configured', async () => {
    // Presenting demo copy as the server's news is worse than an empty section.
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
    await fetchAnnouncements(); // caches the placeholders
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
