/**
 * Every address this launcher ships pointing at White Ravens, in one file.
 *
 * A fork changes these four lines and inherits none of our infrastructure —
 * that is the whole reason they are not scattered through `constants.ts`,
 * `defaults.ts` and the pack catalogue. Nothing else in the codebase should
 * hardcode a whiteravens20 URL.
 *
 * The two feed addresses are *defaults*: they seed a fresh install and can be
 * replaced under Settings → News. `WHITE_RAVENS_PACKS_URL` is deliberately not
 * a default but a constant — see its own note.
 */

/** Where the published feeds and pack manifests live. */
const PACKS_SITE = 'https://whiteravens20.github.io/raven-packs';

/** Seeds `newsFeedUrl`. Replaceable in Settings; clearing the field turns news off. */
export const DEFAULT_NEWS_FEED_URL = `${PACKS_SITE}/raven-forge/news.json`;

/** Seeds `announcementFeedUrl`, on the same terms. */
export const DEFAULT_ANNOUNCEMENT_FEED_URL = `${PACKS_SITE}/raven-forge/announcements.json`;

/**
 * The catalogue behind "play on the White Ravens servers".
 *
 * Compiled in rather than configurable, unlike the feeds above. Its entries
 * become manifest URLs the launcher creates profiles from, so a settable
 * address would turn a screen badged White Ravens into a way to serve somebody
 * arbitrary manifests. The manifest-URL and `.mrpack` routes exist for anything
 * else, and there it is plainly the player's own address.
 */
export const WHITE_RAVENS_PACKS_URL = `${PACKS_SITE}/packs.json`;
