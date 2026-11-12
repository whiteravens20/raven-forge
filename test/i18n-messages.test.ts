// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { readdirSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { LOCALES } from '../src/shared/locale';

/**
 * What the message files promise each other, and what the main process promises
 * them.
 *
 * Each language is one JSON file in `src/renderer/i18n/`, the way Weblate reads
 * and writes it, so the type system knows English's keys and nothing more. The
 * rest is held here: a language the launcher ships has every message, and any
 * other file, which may be a translation still in progress and is never loaded,
 * has nothing English lacks.
 *
 * The placeholders are the real subject. `interpolate` replaces `{name}` when
 * `name` is among the variables it was handed and leaves the braces standing
 * when it is not — a deliberate choice, since a half-substituted sentence is
 * more use than a crash, but it means every mismatch is silent. A translation
 * that localises the placeholder along with the words, or an emitter that names
 * `mcVersion` where the sentence says `{version}`, shows the player a line with
 * `{version}` in the middle of it and nothing anywhere reports a fault. That is
 * the same failure this suite exists to catch elsewhere: the launcher saying
 * something untrue about what it is doing.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, '..', 'src');
const messagesDir = path.join(srcDir, 'renderer', 'i18n');

/**
 * Every message file in the folder as text, by its language code: the languages
 * the launcher ships and any translation still in progress. Read from the disk
 * rather than through `import.meta.glob`, so a file added to the folder is seen
 * whatever Vitest has cached.
 */
const files = new Map(
  readdirSync(messagesDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => [
      path.basename(name, '.json'),
      readFileSync(path.join(messagesDir, name), 'utf-8'),
    ]),
);

/** A form of a message that depends on a number: `<key>_<category>`. */
const PLURAL_FORM = /^(.+)_(zero|one|two|few|many|other)$/;

/** The `{name}` placeholders a text will substitute. */
function placeholders(text: string): Set<string> {
  return new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
}

/**
 * A file's messages by key. A plain message has its text under `''`; one that
 * depends on a number has a text for each plural category the file gives it.
 */
function read(code: string): Map<string, Map<string, string>> {
  const data: unknown = JSON.parse(files.get(code) ?? 'null');
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`${code}.json holds no object`);
  }
  const messages = new Map<string, Map<string, string>>();
  for (const [name, text] of Object.entries(data)) {
    if (typeof text !== 'string') throw new Error(`${name} in ${code}.json is not a text`);
    const [, key, category] = PLURAL_FORM.exec(name) ?? [name, name, ''];
    messages.set(key, (messages.get(key) ?? new Map<string, string>()).set(category, text));
  }
  return messages;
}

/** Every text of a file, under the name it has there. */
function texts(code: string): Array<[name: string, text: string]> {
  return [...read(code)].flatMap(([key, forms]) =>
    [...forms].map(([category, text]): [string, string] => [
      category ? `${key}_${category}` : key,
      text,
    ]),
  );
}

function kind(forms: Map<string, string>): string {
  if (!forms.has('')) return 'plural';
  return forms.size === 1 ? 'plain' : 'plain and plural';
}

/** The tag `Intl` knows a file's language by: Weblate may name a file `pt_BR`. */
const languageTag = (code: string) => code.replace('_', '-');

/**
 * The whole numbers each plural category of a language takes. CLDR's rules look
 * at no more than the last six digits of a number, so 0 to 1000 and a million
 * reach every category a count can fall into. Polish has `one`, `few` and
 * `many`; its `other` is for fractions, which no count is, and Weblate does not
 * write it — so a check that wanted every entry of `pluralCategories` would
 * fail on Weblate's own Polish file.
 */
function wholeNumbers(code: string): Map<string, number[]> {
  const rules = new Intl.PluralRules(languageTag(code));
  const taken = new Map<string, number[]>();
  for (const n of [...Array(1001).keys(), 1_000_000]) {
    const category = rules.select(n);
    taken.set(category, [...(taken.get(category) ?? []), n]);
  }
  return taken;
}

const english = read('en');

describe('the message files', () => {
  it('include one for each language the launcher ships', () => {
    expect(LOCALES.filter((code) => !files.has(code))).toEqual([]);
  });

  it('name each English message with dotted words', () => {
    // Some end in a value the code puts there, such as `version-change`. An
    // underscore would read as a plural form.
    const word = /^[a-z][A-Za-z0-9-]*(\.[a-z][A-Za-z0-9-]*)*$/;
    expect([...english.keys()].filter((key) => !word.test(key))).toEqual([]);
  });
});

describe.each([...files.keys()])('%s.json', (code) => {
  it('is one flat object of texts', () => {
    expect(() => read(code)).not.toThrow();
  });

  it('is named by a language code', () => {
    expect(Intl.PluralRules.supportedLocalesOf(languageTag(code))).toHaveLength(1);
  });

  it('has no message English lacks, each of the same kind', () => {
    const wrong: string[] = [];
    for (const [key, forms] of read(code)) {
      const source = english.get(key);
      if (!source) wrong.push(`${key} is not in en.json`);
      else if (kind(forms) !== kind(source)) {
        wrong.push(`${key} is ${kind(forms)}, in English ${kind(source)}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('leaves no text empty', () => {
    const empty = texts(code)
      .filter(([, text]) => text.trim() === '')
      .map(([name]) => name);
    expect(empty).toEqual([]);
  });

  it('closes every brace it opens', () => {
    // `{count` renders verbatim and reads as a typo in the product. The pattern
    // that finds placeholders simply does not match it, so nothing else notices.
    const suspect = texts(code)
      .filter(([, text]) => (text.match(/\{/g)?.length ?? 0) !== (text.match(/\}/g)?.length ?? 0))
      .map(([name]) => name);
    expect(suspect).toEqual([]);
  });

  it('gives a message that depends on a number the forms whole numbers take', () => {
    // A missing form is not a crash: `plural()` falls back to English, and a
    // Polish player reads "5 mods" in the middle of a Polish page.
    const categories = [...wholeNumbers(code).keys()].sort().join(', ');
    const wrong: string[] = [];
    for (const [key, forms] of read(code)) {
      if (kind(forms) !== 'plural') continue;
      const given = [...forms.keys()].sort().join(', ');
      if (given !== categories) wrong.push(`${key} has ${given}, not ${categories}`);
    }
    expect(wrong).toEqual([]);
  });

  it('keeps the placeholders of the English message, and no others', () => {
    // A form whose category takes one whole number alone may write the number
    // out, as English "one file" does. Any other form keeps `{count}`: in
    // Russian, `one` is also 21 and 31.
    const taken = wholeNumbers(code);
    const wrong: string[] = [];
    for (const [key, forms] of read(code)) {
      const source = english.get(key);
      if (!source) continue;
      const expected = new Set([...source.values()].flatMap((text) => [...placeholders(text)]));
      for (const [category, text] of forms) {
        const name = category ? `${key}_${category}` : key;
        const names = placeholders(text);
        const spelledOut = taken.get(category)?.length === 1;
        const missing = [...expected].filter(
          (wanted) => !names.has(wanted) && !(wanted === 'count' && spelledOut),
        );
        const extra = [...names].filter((given) => !expected.has(given));
        if (missing.length > 0) wrong.push(`${name} lacks {${missing}}`);
        if (extra.length > 0) wrong.push(`${name} asks for {${extra}}, which English does not`);
      }
    }
    expect(wrong).toEqual([]);
  });

  if ((LOCALES as readonly string[]).includes(code)) {
    it('has every message, as a language the launcher ships must', () => {
      const messages = read(code);
      expect([...english.keys()].filter((key) => !messages.has(key))).toEqual([]);
    });
  }
});

describe('what the main process names', () => {
  /** English's texts by their names in en.json, plural forms included. */
  const dictionary = new Map(texts('en'));

  async function sourceFiles(dir: string): Promise<string[]> {
    const out: string[] = [];
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...(await sourceFiles(full)));
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  /**
   * Every `{ key: '…', vars: { … } }` written anywhere under `src/`.
   *
   * Read out of the source text rather than by importing the modules: the
   * emitters are spread across the main process and would drag Electron, the
   * network stack and the keychain in behind them, and the thing being checked
   * is a literal that is right there in the file.
   */
  async function emittedMessages(): Promise<Array<{ key: string; vars: string[]; file: string }>> {
    const found: Array<{ key: string; vars: string[]; file: string }> = [];
    for (const file of await sourceFiles(srcDir)) {
      const text = await fs.readFile(file, 'utf-8');
      for (const match of text.matchAll(
        /\b(?:key|pluralKey):\s*'([\w.]+)'\s*(?:,\s*count:[^,}]+)?\s*(?:,\s*vars:\s*\{([^}]*)\})?/g,
      )) {
        const varsBlock = match[2];
        // A spread or a variable stands for something this cannot read; the key
        // itself is still worth checking, so it is kept without its variables.
        const vars =
          varsBlock === undefined || varsBlock.includes('...')
            ? []
            : [...varsBlock.matchAll(/(\w+)\s*:/g)].map((m) => m[1]);
        found.push({ key: match[1], vars, file: path.relative(srcDir, file) });
      }
    }
    return found;
  }

  /** The English a key stands for: the text itself, or its `_other` form. */
  const englishFor = (key: string) => dictionary.get(key) ?? dictionary.get(`${key}_other`);

  it('finds the progress and error messages to check', async () => {
    // A regex that quietly matched nothing would make every assertion below
    // pass without looking at anything.
    const messages = await emittedMessages();
    expect(messages.length).toBeGreaterThan(20);
    expect(messages.map((m) => m.key)).toContain('progress.msg.checkingLibraries');
    expect(messages.map((m) => m.key)).toContain('progress.msg.synced');
  });

  it('names only keys the messages can say', async () => {
    const unknown = (await emittedMessages())
      .filter(({ key }) => englishFor(key) === undefined)
      .map(({ key, file }) => `${key} (${file})`);
    expect(unknown).toEqual([]);
  });

  it('supplies every variable the sentence asks for', async () => {
    const short: string[] = [];
    for (const { key, vars, file } of await emittedMessages()) {
      const template = englishFor(key);
      if (template === undefined) continue;
      // `count` is supplied by `plural()` itself and is never written at the
      // call site.
      const missing = [...placeholders(template)].filter(
        (name) => name !== 'count' && !vars.includes(name),
      );
      // Only the emitters that state their variables are judged; one that
      // spreads an object was recorded with none and cannot be read from here.
      if (vars.length > 0 && missing.length > 0) {
        short.push(`${key} wants {${missing}} (${file})`);
      }
    }
    expect(short).toEqual([]);
  });

  it('passes no variable the sentence has no place for', async () => {
    // The harmless direction of the same mismatch, and the one that shows a
    // rename half-done: the emitter starts saying `mcVersion`, the dictionary
    // still says `{version}`, and the line the player reads keeps its braces.
    const spare: string[] = [];
    for (const { key, vars, file } of await emittedMessages()) {
      const template = englishFor(key);
      if (template === undefined) continue;
      const names = placeholders(template);
      const extra = vars.filter((name) => !names.has(name));
      if (extra.length > 0) spare.push(`${key} was given {${extra}} (${file})`);
    }
    expect(spare).toEqual([]);
  });
});
