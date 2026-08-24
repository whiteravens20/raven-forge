import type { Locale } from '@shared/ipc-types';

/**
 * Text that arrived as data rather than out of a dictionary.
 *
 * The pack catalogue carries its own summaries, written by whoever published
 * the pack, so they can never be translation keys. What they can be is a map
 * keyed by locale — and this picks the entry for the language the player chose.
 *
 * The fallback order is the reverse of `translate()`'s. There, English is the
 * last resort because every string started as Polish. Here the map was
 * published for a wider audience than this app's UI, so English is the first
 * thing to try after the player's own language, and anything at all beats
 * nothing: a summary in the wrong language still says what the pack is.
 *
 * Its own module, and not part of `index.ts`, so it can be tested without
 * dragging React and the settings store into a node test.
 */
export function localized(
  value: string | Partial<Record<string, string>> | undefined,
  locale: Locale,
  fallback = '',
): string {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  return value[locale] || value.en || Object.values(value).find(Boolean) || fallback;
}
