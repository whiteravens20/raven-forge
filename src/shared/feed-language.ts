// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

/**
 * A feed entry, as somebody reading in `language` should see it.
 *
 * A feed is written in whatever language its operator writes in, and that is
 * what everybody sees, unless an entry says something again in their language.
 * Nothing has to be translated, and nothing has to be translated whole: what a
 * translation leaves out stays as the entry has it. So a launcher with one more
 * language asks nothing of any feed, and an operator with one language has
 * nothing to do.
 *
 * It is worked out here, from what is already on the computer, because a feed is
 * one file for everybody. The address the launcher asks at does not depend on
 * the language, so the server is not told it, and static hosting will do.
 */
export function inLanguage<T extends { translations?: Record<string, Partial<T>> }>(
  entry: T,
  language: string,
): T {
  if (!entry.translations) return entry;
  const said = translationFor(entry.translations, language.toLowerCase());
  if (!said) return entry;
  const given = Object.entries(said).filter(([, text]) => Boolean(text));
  return { ...entry, ...Object.fromEntries(given) };
}

/** The language itself, then its plain form (`pt` for `pt-br`), then any form of it (`pt-br` for `pt`). */
function translationFor<V>(translations: Record<string, V>, language: string): V | undefined {
  const [plain] = language.split('-');
  return (
    translations[language] ??
    translations[plain] ??
    Object.entries(translations).find(([tag]) => tag.split('-')[0] === plain)?.[1]
  );
}
