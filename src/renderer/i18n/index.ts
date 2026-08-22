import { useMemo } from 'react';
import { useSettingsStore } from '@stores/settings-store';
import type { Locale } from '@shared/ipc-types';
import { en, type PluralKey, type TranslationKey, type Translations } from './en';
import { pl } from './pl';

export type { TranslationKey, Translations, PluralKey, Locale };

/**
 * Deliberately not an i18n library.
 *
 * The whole feature set needed here is: pick a dictionary, substitute a few
 * placeholders, and get plural agreement right in Polish. `Intl.PluralRules`
 * ships with the platform and does the only genuinely hard part, so the rest
 * is about forty lines and no dependency.
 */

/**
 * `Locale` is declared in `@shared/ipc-types` because the settings schema
 * validates against it in the main process. `satisfies` keeps this map and that
 * union in step: adding a locale there without a dictionary here fails to
 * compile.
 */
export const LOCALES = { pl, en } satisfies Record<Locale, Translations>;

/** Endonyms — a language is listed the way its own speakers write it. */
export const LOCALE_NAMES: Record<Locale, string> = {
  pl: 'Polski',
  en: 'English',
};

/**
 * Polish, not English. The UI was written in Polish first and every string in
 * `en.ts` is a translation of one; falling back to English would change the
 * language of the app for anyone who never touched the setting.
 */
const DEFAULT_LOCALE: Locale = 'pl';

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && value in LOCALES;
}

/** Settings store `language` as a usable locale, whatever ends up in the file. */
export function asLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

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
  const template = LOCALES[locale][key] ?? en[key];
  return interpolate(template, vars);
}

// ── Plurals ────────────────────────────────────────────────
// A counted string is stored as several keys — `foo.one`, `foo.few`,
// `foo.many`, `foo.other` — and the right one is chosen per locale.

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
  const category = rulesFor(locale).select(count);
  // English never produces `few`/`many`, and a translator may legitimately
  // leave a category out where their language does not distinguish it, so an
  // absent variant falls back to `.other` instead of vanishing.
  const dict: Partial<Record<string, string>> = LOCALES[locale];
  const fallback: Partial<Record<string, string>> = en;
  const template =
    dict[`${base}.${category}`] ?? dict[`${base}.other`] ?? fallback[`${base}.other`] ?? base;
  return interpolate(template, { count, ...vars });
}

// ── React bindings ─────────────────────────────────────────

export function useLocale(): Locale {
  return useSettingsStore((s) => asLocale(s.settings?.language));
}

export interface TFunction {
  (key: TranslationKey, vars?: TranslationVars): string;
  /** Counted variant: `t.plural('logs.errorCount', 3)`. */
  plural: (base: PluralKey, count: number, vars?: TranslationVars) => string;
}

export function useT(): TFunction {
  const locale = useLocale();
  return useMemo(() => {
    const fn = (key: TranslationKey, vars?: TranslationVars) => translate(locale, key, vars);
    fn.plural = (base: PluralKey, count: number, vars?: TranslationVars) =>
      plural(locale, base, count, vars);
    return fn;
  }, [locale]);
}

/**
 * Outside React — class components, event handlers created before render.
 * Prefer `useT()` anywhere a hook is allowed; this does not re-render on a
 * language change.
 */
export function t(key: TranslationKey, vars?: TranslationVars): string {
  return translate(asLocale(useSettingsStore.getState().settings?.language), key, vars);
}
