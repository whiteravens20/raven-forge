// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

/**
 * Languages the profile editor offers for the game itself.
 *
 * A short list, not Minecraft's full one. The game ships around 130 locales,
 * a good number of them jokes, and a dropdown that long is one nobody reads.
 * These are the ones a player is likely to want; anything else is still a line
 * away in the game's own language screen, which a profile that sets nothing
 * here leaves alone.
 *
 * The code is what `options.txt` stores under `lang`, lowercase as Minecraft
 * has written it since 1.11. Names are endonyms, the way the game's own list
 * shows them, so a language reads the same whatever the launcher is set to.
 */
export const GAME_LANGUAGES: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'en_us', name: 'English (US)' },
  { code: 'en_gb', name: 'English (UK)' },
  { code: 'pl_pl', name: 'Polski' },
  { code: 'de_de', name: 'Deutsch' },
  { code: 'fr_fr', name: 'Français' },
  { code: 'es_es', name: 'Español (España)' },
  { code: 'es_mx', name: 'Español (México)' },
  { code: 'it_it', name: 'Italiano' },
  { code: 'pt_br', name: 'Português (Brasil)' },
  { code: 'pt_pt', name: 'Português (Portugal)' },
  { code: 'nl_nl', name: 'Nederlands' },
  { code: 'sv_se', name: 'Svenska' },
  { code: 'nb_no', name: 'Norsk bokmål' },
  { code: 'da_dk', name: 'Dansk' },
  { code: 'fi_fi', name: 'Suomi' },
  { code: 'cs_cz', name: 'Čeština' },
  { code: 'sk_sk', name: 'Slovenčina' },
  { code: 'hu_hu', name: 'Magyar' },
  { code: 'ro_ro', name: 'Română' },
  { code: 'uk_ua', name: 'Українська' },
  { code: 'ru_ru', name: 'Русский' },
  { code: 'bg_bg', name: 'Български' },
  { code: 'el_gr', name: 'Ελληνικά' },
  { code: 'tr_tr', name: 'Türkçe' },
  { code: 'lt_lt', name: 'Lietuvių' },
  { code: 'lv_lv', name: 'Latviešu' },
  { code: 'et_ee', name: 'Eesti' },
  { code: 'ja_jp', name: '日本語' },
  { code: 'ko_kr', name: '한국어' },
  { code: 'zh_cn', name: '简体中文' },
  { code: 'zh_tw', name: '繁體中文' },
];

/**
 * The shape of a Minecraft locale code: language, underscore, region.
 *
 * Checked because the value is written into a line of `options.txt`. A code
 * the game does not ship is harmless — it falls back to English — but one with
 * a newline in it would be a second line of somebody else's choosing.
 */
export const GAME_LANGUAGE_PATTERN = /^[a-z]{2,3}_[a-z0-9]{2,4}$/;
