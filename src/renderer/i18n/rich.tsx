import { Fragment, type ReactNode } from 'react';
import { useT, type TranslationKey, type TranslationVars } from './index';

/**
 * Inline emphasis inside a translated string.
 *
 * Splitting a sentence into `…before`, `…emphasis` and `…after` keys is the
 * usual alternative, and it breaks the moment a language wants the emphasised
 * phrase somewhere else in the sentence. Two markers — `*em*` and `**strong**`
 * — keep the sentence whole and let the translator move the emphasis.
 *
 * This exists for the chronicle's prose, which is the only rich text in the
 * app. Everything else goes through `useT()` and renders verbatim.
 */

// `**strong**` first so its inner asterisks are consumed before `*em*` sees them.
const MARKUP_RE = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;

function renderRich(text: string): ReactNode {
  const parts = text.split(MARKUP_RE);
  if (parts.length === 1) return text;

  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function useRichT(): (key: TranslationKey, vars?: TranslationVars) => ReactNode {
  const t = useT();
  return (key, vars) => renderRich(t(key, vars));
}

const PLACEHOLDER_RE = /(\{\w+\})/g;

/**
 * Substitute React nodes — links, usually — into a translated sentence.
 *
 * The alternative is chopping the sentence into `…before` / `…after` keys,
 * which locks the link to one position and falls apart in any language that
 * orders the clause differently. Here the whole sentence stays one string and
 * the placeholders move with it.
 *
 * A placeholder with no matching node is left as-is rather than silently
 * dropped, so a mistake is visible instead of quietly eating words.
 */
export function interleave(template: string, nodes: Record<string, ReactNode>): ReactNode {
  return template.split(PLACEHOLDER_RE).map((part, i) => {
    const name = part.startsWith('{') && part.endsWith('}') ? part.slice(1, -1) : null;
    if (name && name in nodes) return <Fragment key={i}>{nodes[name]}</Fragment>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}
