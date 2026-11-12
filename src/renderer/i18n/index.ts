// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { useMemo } from 'react';
import { useSettingsStore } from '../stores/settings-store';
import type { ErrorMessage } from '@shared/ipc-types';
import { LOCALES, pickLocale, type Locale } from '@shared/locale';
import {
  plural,
  translate,
  type PluralKey,
  type TranslationKey,
  type TranslationVars,
} from './messages';

export type { PluralKey, TranslationKey, TranslationVars };
export { localized } from './localized';

/**
 * Deliberately not an i18n library.
 *
 * The whole feature set needed here is: pick a language's messages, substitute
 * a few placeholders, and get plural agreement right in Polish.
 * `Intl.PluralRules` ships with the platform and does the only genuinely hard
 * part, so the rest is about forty lines and no dependency.
 */

/** Endonyms — a language is listed the way its own speakers write it. */
export const LOCALE_NAMES: Record<Locale, string> = {
  pl: 'Polski',
  en: 'English',
};

/**
 * For the moment before the settings arrive, with the rule a first start goes
 * by: whatever is saved takes over as soon as they do.
 */
const BEFORE_SETTINGS: Locale = pickLocale(navigator.languages);

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Settings store `language` as a usable locale, whatever ends up in the file. */
export function asLocale(value: unknown): Locale {
  return isLocale(value) ? value : BEFORE_SETTINGS;
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

/**
 * What a failed call to the main process says to the player: in their language
 * when the failure comes with a key, and otherwise in the English the log holds,
 * or in the page's own words when it gave none.
 */
export function failureText(
  result: { error?: string; errorMessage?: ErrorMessage },
  fallback: string,
): string {
  return result.errorMessage
    ? t(result.errorMessage.key, result.errorMessage.vars)
    : (result.error ?? fallback);
}
