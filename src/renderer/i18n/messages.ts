// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import type { Locale } from '@shared/locale';
import en from './en.json';
import pl from './pl.json';

/**
 * The messages and the two lookups over them. Its own module, and not part of
 * `index.ts`, so it can be tested without dragging React and the settings store
 * into a node test.
 */

/**
 * A language's messages by key, as its file in this folder holds them: one flat
 * object, with English the source the others translate. A message that depends
 * on a number has a key for each plural category whole numbers fall into in the
 * language: `<key>_one` and `<key>_other` in English, `<key>_one`, `<key>_few`
 * and `<key>_many` in Polish. That is i18next's way of writing them, which
 * Weblate reads.
 */
type Messages = Readonly<Partial<Record<string, string>>>;

/**
 * Only the languages of `LOCALES` are loaded: another file in this folder may be
 * a translation still in progress. `satisfies` keeps this map and that list in
 * step, so a language added there without its file here fails to compile.
 */
const MESSAGES = { pl, en } satisfies Record<Locale, Messages>;

type Key = keyof typeof en;
type PluralBase<K> = K extends `${infer Base}_other` ? Base : never;

/** A message that depends on a number. English has an `_other` form of each. */
export type PluralKey = PluralBase<Key>;
/** A plain message. */
export type TranslationKey = Exclude<Key, `${PluralKey}_${Intl.LDMLPluralRule}`>;

export type TranslationVars = Record<string, string | number>;

function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export function translate(locale: Locale, key: TranslationKey, vars?: TranslationVars): string {
  // English is the last resort rather than the raw key: a locale that is
  // missing an entry should degrade to a readable sentence, not to
  // `settings.trustedKeysHint` in the middle of a settings page.
  const messages: Messages = MESSAGES[locale];
  return interpolate(messages[key] ?? en[key], vars);
}

// ── Plurals ────────────────────────────────────────────────
// A counted message is stored as one key per plural category — `foo_one`,
// `foo_few`, `foo_many` — and the right one is chosen per locale.

const pluralRules = new Map<Locale, Intl.PluralRules>();

function rulesFor(locale: Locale): Intl.PluralRules {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules;
}

export function plural(
  locale: Locale,
  base: PluralKey,
  count: number,
  vars?: TranslationVars,
): string {
  // A language the launcher ships has a form for every category a whole number
  // falls into, and the tests hold it to that. English answers only for a count
  // no form is written for, such as a fraction in Polish, whose `other` category
  // takes no whole number.
  const messages: Messages = MESSAGES[locale];
  const english: Messages = en;
  const template =
    messages[`${base}_${rulesFor(locale).select(count)}`] ??
    english[`${base}_${rulesFor('en').select(count)}`] ??
    en[`${base}_other`];
  return interpolate(template, { count, ...vars });
}
