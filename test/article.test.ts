import { describe, it, expect } from 'vitest';
import { parseArticle, parseSpans } from '../src/shared/article';

/**
 * Feed bodies are untrusted input from a URL the user pasted, and the reader
 * renders them as React elements rather than HTML. These tests pin the two
 * properties that matter: markup in a feed stays *text*, and a marker the parser
 * does not understand does not eat the sentence around it.
 */
describe('parseSpans', () => {
  it('leaves plain text alone', () => {
    expect(parseSpans('hello world')).toEqual([{ kind: 'text', text: 'hello world' }]);
  });

  it('reads bold before italic, so ** is never two *', () => {
    expect(parseSpans('a **b** c')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', text: 'b' },
      { kind: 'text', text: ' c' },
    ]);
  });

  it('reads italic and code', () => {
    expect(parseSpans('*i* and `c`')).toEqual([
      { kind: 'italic', text: 'i' },
      { kind: 'text', text: ' and ' },
      { kind: 'code', text: 'c' },
    ]);
  });

  it('keeps an unclosed marker literal instead of swallowing the rest', () => {
    expect(parseSpans('50% **off for the rest of the line')).toEqual([
      { kind: 'text', text: '50% **off for the rest of the line' },
    ]);
  });

  it('reads an http(s) link', () => {
    expect(parseSpans('see [docs](https://example.com/a)')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', text: 'docs', href: 'https://example.com/a' },
    ]);
  });

  it('keeps a URL that contains parentheses whole', () => {
    // Stopping at the first `)` closed the link early and dropped the rest of
    // the URL into the prose.
    expect(parseSpans('[x](https://e.com/Foo_(bar))')).toEqual([
      { kind: 'link', text: 'x', href: 'https://e.com/Foo_(bar)' },
    ]);
  });

  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,<b>x', '/relative'])(
    'refuses to link %s, keeping its text',
    (href) => {
      // The text survives — dropping it would silently delete a sentence the
      // author wrote — but nothing will ever hand that scheme to a browser.
      expect(parseSpans(`click [here](${href}) now`)).toEqual([
        { kind: 'text', text: 'click ' },
        { kind: 'text', text: 'here' },
        { kind: 'text', text: ' now' },
      ]);
    },
  );

  it('treats HTML as the characters it is made of', () => {
    // Nothing downstream interprets this: `Span.text` reaches React as a text
    // node. A parser that emitted markup here would be the whole bug.
    const spans = parseSpans('<img src=x onerror=alert(1)>');
    expect(spans).toEqual([{ kind: 'text', text: '<img src=x onerror=alert(1)>' }]);
  });
});

describe('parseArticle', () => {
  it('joins wrapped lines into one paragraph and splits on a blank line', () => {
    expect(parseArticle('one\ntwo\n\nthree')).toEqual([
      { kind: 'paragraph', spans: [{ kind: 'text', text: 'one two' }] },
      { kind: 'paragraph', spans: [{ kind: 'text', text: 'three' }] },
    ]);
  });

  it('reads a heading at any depth', () => {
    expect(parseArticle('## What changed')).toEqual([
      { kind: 'heading', spans: [{ kind: 'text', text: 'What changed' }] },
    ]);
    expect(parseArticle('# Top')).toEqual([
      { kind: 'heading', spans: [{ kind: 'text', text: 'Top' }] },
    ]);
  });

  it('groups consecutive list items and accepts either bullet', () => {
    expect(parseArticle('- one\n* two')).toEqual([
      {
        kind: 'list',
        items: [[{ kind: 'text', text: 'one' }], [{ kind: 'text', text: 'two' }]],
      },
    ]);
  });

  it('lets a list interrupt a paragraph without a blank line', () => {
    // Someone writing release notes will not leave a blank line before the
    // bullets, and the run-on paragraph that produced was unreadable.
    const blocks = parseArticle('Changes:\n- one\n- two');
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'list']);
  });

  it('lets a heading interrupt a paragraph', () => {
    expect(parseArticle('intro\n## next').map((b) => b.kind)).toEqual(['paragraph', 'heading']);
  });

  it('returns nothing for an empty or whitespace-only body', () => {
    expect(parseArticle('')).toEqual([]);
    expect(parseArticle('  \n\n \n')).toEqual([]);
  });

  it('handles CRLF, because a feed may well be edited on Windows', () => {
    expect(parseArticle('one\r\n\r\ntwo').map((b) => b.kind)).toEqual(['paragraph', 'paragraph']);
  });

  it('carries inline markup into headings and list items', () => {
    expect(parseArticle('- **bold** item')).toEqual([
      {
        kind: 'list',
        items: [
          [
            { kind: 'bold', text: 'bold' },
            { kind: 'text', text: ' item' },
          ],
        ],
      },
    ]);
  });
});
