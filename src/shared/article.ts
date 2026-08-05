/**
 * A deliberately small Markdown subset for news and announcement bodies.
 *
 * The launcher is the only reader these feeds have — there is no website to
 * link out to — so plain text would make release notes unreadable. What it does
 * *not* do is produce HTML: the parser emits a description of the document and
 * the renderer turns that into React elements, so a feed can never inject
 * markup. That rules out the whole class of bugs a `dangerouslySetInnerHTML`
 * shortcut would open, since feed URLs are user-supplied and untrusted.
 *
 * Supported: `## heading`, `- item`, `**bold**`, `*italic*`, `` `code` ``,
 * `[text](https://…)`, and blank-line-separated paragraphs. Anything else is
 * text, spelled exactly as written.
 */

export type Span =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

export type Block =
  | { kind: 'heading'; spans: Span[] }
  | { kind: 'paragraph'; spans: Span[] }
  | { kind: 'list'; items: Span[][] };

/** Only what a browser should be asked to open. `javascript:` is not a link. */
function isSafeHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

/**
 * One pass over a line, longest-marker-first so `**bold**` is never mistaken
 * for two italics. An unclosed marker stays literal rather than swallowing the
 * rest of the paragraph.
 *
 * The link target allows one level of nested parentheses — Wikipedia URLs have
 * them, and stopping at the first `)` closed the link early and left the rest
 * of the URL sitting in the prose.
 */
const INLINE =
  /\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`/g;

export function parseSpans(line: string): Span[] {
  const spans: Span[] = [];
  let last = 0;

  for (const match of line.matchAll(INLINE)) {
    const [whole, linkText, href, bold, italic, code] = match;
    const start = match.index;
    if (start > last) spans.push({ kind: 'text', text: line.slice(last, start) });

    if (linkText !== undefined && href !== undefined) {
      // An unsafe scheme keeps its text and loses its link — dropping the text
      // would silently delete a sentence the author wrote.
      spans.push(
        isSafeHref(href)
          ? { kind: 'link', text: linkText, href }
          : { kind: 'text', text: linkText },
      );
    } else if (bold !== undefined) spans.push({ kind: 'bold', text: bold });
    else if (italic !== undefined) spans.push({ kind: 'italic', text: italic });
    else if (code !== undefined) spans.push({ kind: 'code', text: code });

    last = start + whole.length;
  }

  if (last < line.length) spans.push({ kind: 'text', text: line.slice(last) });
  return spans;
}

export function parseArticle(body: string): Block[] {
  const blocks: Block[] = [];
  // Paragraphs run until a blank line; a heading or a list interrupts one, so
  // `text\n- item` is a paragraph followed by a list rather than one run-on.
  let paragraph: string[] = [];
  let list: Span[][] | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', spans: parseSpans(paragraph.join(' ')) });
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push({ kind: 'list', items: list });
    list = null;
  };

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();

    if (line === '') {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: 'heading', spans: parseSpans(heading[1]) });
      continue;
    }

    const item = /^[-*]\s+(.*)$/.exec(line);
    if (item) {
      flushParagraph();
      list ??= [];
      list.push(parseSpans(item[1]));
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}
