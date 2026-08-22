import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { en } from '../src/renderer/i18n/en';
import { pl } from '../src/renderer/i18n/pl';

/**
 * What the dictionaries promise each other, and what the main process promises
 * the dictionaries.
 *
 * Key parity is not checked here: `pl` is declared as `Translations`, so a
 * missing or invented key is a compile error already, and a test that repeats
 * the type checker is a test that will one day disagree with it. What is left
 * is everything TypeScript has no opinion about.
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

/** The `{name}` placeholders a template will substitute, in no particular order. */
function placeholders(template: string): Set<string> {
  return new Set([...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
}

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(full)));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const dictionary = en as Record<string, string>;
const polish = pl as Record<string, string>;

describe('the dictionaries', () => {
  it('asks for no variable English does not already ask for', () => {
    // One direction only. Dropping a placeholder is a translator's prerogative
    // — Polish `.other` is reached only by a fractional count, so those
    // sentences are written without the number in them on purpose. Adding one
    // is the failure: nothing supplies `{wersja}`, so the braces reach the
    // player intact.
    const invented: string[] = [];
    for (const [key, english] of Object.entries(dictionary)) {
      const known = placeholders(english);
      const extra = [...placeholders(polish[key] ?? '')].filter((name) => !known.has(name));
      if (extra.length > 0) invented.push(`${key}: pl asks for {${extra}}, en does not`);
    }
    expect(invented).toEqual([]);
  });

  it('leaves no entry empty', () => {
    const empty = Object.entries({ ...dictionary, ...polish })
      .filter(([, value]) => value.trim() === '')
      .map(([key]) => key);
    expect(empty).toEqual([]);
  });

  it('closes every brace it opens', () => {
    // `{count` renders verbatim and reads as a typo in the product. The regex
    // that finds placeholders simply does not match it, so nothing else notices.
    const suspect = Object.entries({ ...dictionary, ...polish })
      .filter(
        ([, value]) => (value.match(/\{/g)?.length ?? 0) !== (value.match(/\}/g)?.length ?? 0),
      )
      .map(([key]) => key);
    expect(suspect).toEqual([]);
  });

  it('gives Polish all four plural categories', () => {
    // Polish selects `one`, `few`, `many` and `other`, and a missing category
    // falls back to `.other` rather than failing: "5 mod" instead of "5 modów",
    // shipped and silent. English needs only `one` and `other`, which is why
    // the fallback exists at all.
    const bases = Object.keys(dictionary)
      .filter((key) => key.endsWith('.one'))
      .map((key) => key.slice(0, -'.one'.length));
    expect(bases.length).toBeGreaterThan(5);

    const incomplete = bases.filter((base) =>
      ['one', 'few', 'many', 'other'].some((category) => !(`${base}.${category}` in polish)),
    );
    expect(incomplete).toEqual([]);
  });
});

describe('what the main process names', () => {
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

  it('finds the progress and error messages to check', async () => {
    // A regex that quietly matched nothing would make every assertion below
    // pass without looking at anything.
    const messages = await emittedMessages();
    expect(messages.length).toBeGreaterThan(20);
    expect(messages.map((m) => m.key)).toContain('progress.msg.checkingLibraries');
  });

  it('names only keys the dictionaries can say', async () => {
    const unknown = (await emittedMessages())
      .filter(({ key }) => !(key in dictionary) && !(`${key}.other` in dictionary))
      .map(({ key, file }) => `${key} (${file})`);
    expect(unknown).toEqual([]);
  });

  it('supplies every variable the sentence asks for', async () => {
    const short: string[] = [];
    for (const { key, vars, file } of await emittedMessages()) {
      const template = dictionary[key] ?? dictionary[`${key}.other`];
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
      const template = dictionary[key] ?? dictionary[`${key}.other`];
      if (template === undefined) continue;
      const names = placeholders(template);
      const extra = vars.filter((name) => !names.has(name));
      if (extra.length > 0) spare.push(`${key} was given {${extra}} (${file})`);
    }
    expect(spare).toEqual([]);
  });
});
