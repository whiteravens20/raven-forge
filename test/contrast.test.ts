import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The palette, checked against WCAG AA rather than against taste.
 *
 * A theme token is a colour someone picks by looking at it, and looking at it
 * is exactly what does not work: the light theme shipped with amber text at
 * 2.4:1 for months and nobody reading a warning badge could tell it was two
 * points short of legible. So the numbers are asserted here, on the file that
 * holds them, and a value that stops clearing the bar fails the build instead
 * of failing a user.
 *
 * Everything is measured as *small* text — 4.5:1, not the 3:1 the standard
 * allows for large text. The app has no large body text: the smallest is
 * `text-xs` at 12px and headings are the only thing above 16px.
 */

const CSS_PATH = path.resolve(__dirname, '../src/renderer/styles/global.css');
const CSS = readFileSync(CSS_PATH, 'utf-8');

type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
  const s = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as Rgb;
}

function luminance(c: Rgb): number {
  const [r, g, b] = c.map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * What the compositor actually paints for `bg-rf-warning/10`: the token at 10%
 * over whatever is behind it. Worth doing properly — the tint costs around half
 * a point of contrast, which is the difference between a badge that passes and
 * one that does not.
 */
function composite(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return fg.map((c, i) => c * alpha + bg[i] * (1 - alpha)) as Rgb;
}

/** The `--rf-*` declarations of one theme block in global.css. */
function theme(selector: string): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`);
  expect(start, `${selector} block missing from global.css`).toBeGreaterThan(-1);
  const block = CSS.slice(start, CSS.indexOf('}', start));
  const tokens: Record<string, string> = {};
  for (const [, name, value] of block.matchAll(/--rf-([a-z-]+):\s*(#[0-9a-f]{6});/g)) {
    tokens[name] = value;
  }
  return tokens;
}

const SURFACES = ['bg', 'bg-secondary', 'bg-tertiary', 'surface'] as const;
/** The alphas the components actually use, from `/5` badges to `/20` hovers. */
const TINTS = [0.05, 0.1, 0.15, 0.2];

const THEMES: [string, string][] = [
  ['dark (default)', ':root'],
  ['oled-black', "[data-theme='oled-black']"],
  ['light', "[data-theme='light']"],
];

describe.each(THEMES)('%s theme', (_name, selector) => {
  const t = theme(selector);
  const surfaces = SURFACES.map((s) => [s, rgb(t[s])] as const);

  describe.each(['text', 'text-secondary', 'text-muted'])('--rf-%s', (token) => {
    it.each(surfaces)(`reads on --rf-%s`, (_surface, bg) => {
      expect(contrast(rgb(t[token]), bg)).toBeGreaterThanOrEqual(4.5);
    });
  });

  // The badge colours have to clear the bar twice: bare on a surface, and on a
  // panel tinted with themselves, which is how every badge in the app is built.
  describe.each(['danger', 'warning', 'success', 'accent-text'])('--rf-%s', (token) => {
    it.each(surfaces)(`reads on --rf-%s and on its own tint`, (_surface, bg) => {
      const fg = rgb(t[token]);
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
      for (const alpha of TINTS) {
        expect(contrast(fg, composite(fg, bg, alpha))).toBeGreaterThanOrEqual(4.5);
      }
    });
  });

  it('carries white through the accent fills', () => {
    // Primary buttons are `bg-rf-accent text-white`, which is the reason
    // --rf-accent cannot simply be replaced by a colour that reads as text.
    expect(contrast(rgb('#ffffff'), rgb(t.accent))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb('#ffffff'), rgb(t['accent-hover']))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the close button legible on its danger fill', () => {
    // The one place a semantic colour is used as a fill. Its glyph is --rf-bg,
    // so this is the assertion that the two stay on opposite sides of the
    // lightness the theme sits at.
    expect(contrast(rgb(t.bg), rgb(t.danger))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(surfaces)('shows a focus ring against --rf-%s', (_surface, bg) => {
    // Focus rings are `ring-rf-accent-text`. A focus indicator is a non-text
    // component under 1.4.11, so 3:1 — but it is the only thing telling a
    // keyboard user where they are, and --rf-accent used to manage 2.8:1 here.
    expect(contrast(rgb(t['accent-text']), bg)).toBeGreaterThanOrEqual(3);
  });

  it('keeps the three text greys a visible step apart', () => {
    // Raising --rf-text-muted to AA pushes it up towards --rf-text-secondary,
    // and a ramp whose steps are all within a few percent of each other is one
    // colour wearing three names. Measured against --rf-bg, where body text is.
    const [text, secondary, muted] = ['text', 'text-secondary', 'text-muted'].map((k) =>
      contrast(rgb(t[k]), rgb(t.bg)),
    );
    expect(text / secondary).toBeGreaterThanOrEqual(1.3);
    expect(secondary / muted).toBeGreaterThanOrEqual(1.3);
  });
});

describe('the holding screen in index.html', () => {
  // Its colours are literals — the stylesheet that defines the tokens is what
  // it is covering for — so nothing but a test keeps them in step with the
  // default theme, and it is on screen at every cold start.
  const html = readFileSync(path.resolve(__dirname, '../src/renderer/index.html'), 'utf-8');
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const colours = [...style.matchAll(/#[0-9a-f]{6}/g)].map((m) => m[0]);

  it('is painted in the default theme colours', () => {
    const dark = theme(':root');
    expect(new Set(colours)).toEqual(
      new Set([dark.bg, dark['text-secondary'], dark.border, dark.accent]),
    );
  });

  it('reads at AA', () => {
    const dark = theme(':root');
    expect(contrast(rgb(dark['text-secondary']), rgb(dark.bg))).toBeGreaterThanOrEqual(4.5);
  });
});
