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

import type { Locale, TrustedKey } from './ipc/settings';

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

/**
 * The key White Ravens signs its manifests with, compiled in.
 *
 * Shipped rather than downloaded, and that is the whole point: a key fetched
 * alongside the manifest it vouches for proves nothing, because whoever can
 * rewrite the manifest can rewrite the key next to it. Compiled in, it is as
 * trustworthy as the catalogue URL above — both arrive with the launcher, over
 * the same signed installer, from the same publisher.
 *
 * It verifies; it does not enforce. A player with no keys of their own can
 * still install anybody's manifest — see `assertManifestTrusted`.
 */
export const WHITE_RAVENS_PUBLIC_KEY = 'N/xfUD4XtQ8KMV2weZ8hglLoaYkqTdlFpTngu3p/nA8=';

/**
 * The publisher's own key as a key-ring entry, always present.
 *
 * Without it the launcher's first-party packs read "no trusted keys" on a fresh
 * install, which is the state nearly every player is in — a signature scheme
 * that verifies nothing until the player pastes a key by hand is a scheme that
 * verifies nothing.
 *
 * Lives here rather than beside the verifier because Settings has to show it.
 * A key that silently decides which packs read "Verified", while the screen
 * listing trusted keys shows an empty list, is indistinguishable from a badge
 * the launcher made up.
 *
 * `addedAt` is the epoch because it was never added; the UI labels it built-in
 * instead of printing a date.
 */
export const BUILT_IN_KEYS: TrustedKey[] = [
  {
    name: 'White Ravens',
    publicKey: WHITE_RAVENS_PUBLIC_KEY,
    addedAt: '1970-01-01T00:00:00.000Z',
  },
];

/**
 * Everything the launcher will check a signature against: the player's keys
 * plus the publisher's, without listing a key they added twice.
 *
 * Shared by the verifier and by Settings on purpose — the list the player is
 * shown has to be the list the signature is actually checked against, or the
 * screen is decoration.
 */
export function trustedKeyRing(userKeys: TrustedKey[]): TrustedKey[] {
  return [...BUILT_IN_KEYS, ...userKeys.filter((k) => !isBuiltInKey(k.publicKey))];
}

/** Whether this key came with the launcher, and so cannot be removed. */
export function isBuiltInKey(publicKey: string): boolean {
  return BUILT_IN_KEYS.some((k) => k.publicKey === publicKey);
}

/** The launcher's own source repository — About, and the bug-report links. */
export const REPO_URL = 'https://github.com/whiteravens20/raven-forge';

/** The organisation behind it, for anyone who would rather not open a GitHub account. */
export const ORG_URL = 'https://whiteravens.net';

/**
 * The published privacy policy, one file per UI language.
 *
 * Two files rather than one because the launcher opens in Polish, and a policy
 * a Polish player cannot read has not informed anyone of anything.
 *
 * A `Record<Locale, …>` rather than a ternary on purpose: adding a language to
 * `Locale` without publishing its policy then fails to compile, instead of
 * quietly handing that language the English file. `Translations` is kept honest
 * the same way — see `LOCALES` in `renderer/i18n`.
 */
const PRIVACY_POLICY_FILES: Record<Locale, string> = {
  pl: 'PRIVACY.pl.md',
  en: 'PRIVACY.md',
};

/**
 * The full policy, in the language the launcher is currently speaking.
 *
 * The in-app privacy page answers the same question for the install actually
 * running; this is the whole text, for whoever wants all of it.
 */
export function privacyPolicyUrl(locale: Locale): string {
  return `${REPO_URL}/blob/main/docs/${PRIVACY_POLICY_FILES[locale]}`;
}

/**
 * The crash-report issue form, pre-selected.
 *
 * `template=` names the file under `.github/ISSUE_TEMPLATE/`; without it GitHub
 * shows the chooser, which is one more screen between a player who has just
 * crashed and a filed report. Nothing is pre-filled from the report itself —
 * the body is a file on their disk that they read first and attach knowingly.
 */
export const NEW_CRASH_ISSUE_URL = `${REPO_URL}/issues/new?template=crash_report.md&labels=bug,crash`;
