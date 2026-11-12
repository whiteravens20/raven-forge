// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect } from 'vitest';
import { plural, translate } from '../src/renderer/i18n/messages';

describe('translate', () => {
  it('says a message in the language asked for', () => {
    expect(translate('pl', 'nav.label')).toBe('Nawigacja launchera');
    expect(translate('en', 'nav.label')).toBe('Launcher navigation');
  });

  it('puts in the values it is given and leaves an unnamed placeholder standing', () => {
    expect(translate('en', 'content.title', { profile: 'Survival' })).toBe(
      'Shaders & resource packs — Survival',
    );
    expect(translate('en', 'content.title')).toBe('Shaders & resource packs — {profile}');
  });
});

describe('plural', () => {
  it('words a count by the plural rules of Polish', () => {
    const counts = [1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 0, 101, 112];
    expect(counts.map((n) => plural('pl', 'delete.worlds', n))).toEqual([
      '1 świat',
      '2 światy',
      '4 światy',
      '5 światów',
      '11 światów',
      '12 światów',
      '14 światów',
      '21 światów',
      '22 światy',
      '25 światów',
      '0 światów',
      '101 światów',
      '112 światów',
    ]);
  });

  it('words a count by the plural rules of English', () => {
    expect([1, 0, 2, 21].map((n) => plural('en', 'delete.worlds', n))).toEqual([
      '1 world',
      '0 worlds',
      '2 worlds',
      '21 worlds',
    ]);
  });

  it('puts in the other values beside the count', () => {
    expect(plural('pl', 'home.newsRefreshedNew', 3, { time: '12:00' })).toBe(
      'Sprawdzono o 12:00 — 3 nowe wpisy',
    );
  });

  it('says in English a count a language has no form for, never the key', () => {
    // Polish gives a fraction the `other` category, which no whole number takes
    // and which its file therefore does not have.
    expect(plural('pl', 'delete.worlds', 1.5)).toBe('1.5 worlds');
  });
});
