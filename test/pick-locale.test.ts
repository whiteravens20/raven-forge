// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect } from 'vitest';
import { pickLocale } from '../src/shared/locale';

describe('pickLocale', () => {
  it.each([
    ['Windows and Chromium', 'pl-PL'],
    ['a bare language', 'pl'],
    ['glibc', 'pl_PL'],
    ['glibc with its encoding', 'pl_PL.UTF-8'],
    ['another case', 'PL-pl'],
  ])('reads a language the way %s writes it', (_where, tag) => {
    expect(pickLocale([tag])).toBe('pl');
  });

  it('goes by the order the system gives', () => {
    expect(pickLocale(['pl-PL', 'en-US'])).toBe('pl');
    expect(pickLocale(['en-US', 'pl-PL'])).toBe('en');
    expect(pickLocale(['de-DE', 'pl-PL', 'en-US'])).toBe('pl');
  });

  it.each([
    ['a language it has no dictionary for', ['de-DE']],
    ['one that only starts like a language it has', ['plt-MG', 'enm']],
    ['the C locale', ['C']],
    ['POSIX', ['POSIX']],
    ['an empty entry', ['']],
    ['nothing at all', []],
  ])('falls back to English on %s', (_what, languages) => {
    expect(pickLocale(languages)).toBe('en');
  });
});
