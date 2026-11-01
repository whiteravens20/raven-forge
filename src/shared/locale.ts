// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import type { Locale } from './ipc/settings';

/** `satisfies` has a locale added to the union fail to compile until it is listed here too. */
const WITH_A_DICTIONARY = { pl: true, en: true } satisfies Record<Locale, true>;

function hasDictionary(language: string | undefined): language is Locale {
  return language !== undefined && Object.hasOwn(WITH_A_DICTIONARY, language);
}

/**
 * The language a launcher with nothing saved opens in: the first of the system's
 * languages, in the system's order, that has a dictionary. English when none has,
 * since a window in Polish is no use to somebody on a German system.
 *
 * What the system lists looks different from platform to platform (`pl-PL`,
 * `pl_PL.UTF-8`, `C`), and only the language at the front of it is compared.
 */
export function pickLocale(systemLanguages: readonly string[]): Locale {
  for (const tag of systemLanguages) {
    const language = /^[a-z]+/i.exec(tag)?.[0].toLowerCase();
    if (hasDictionary(language)) return language;
  }
  return 'en';
}
