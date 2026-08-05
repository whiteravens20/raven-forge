/**
 * Ambient types for imported artwork.
 *
 * Two flavours, and which to use is decided by the asset rather than by taste:
 *
 * - **URL** (default) — for art that carries its own colours. Rendered through
 *   `<img src>`, which is cheap and cacheable.
 * - **`?raw`** — required for anything drawn with `currentColor`. An
 *   `<img>`-referenced SVG is an isolated document and does not inherit the
 *   page's colour, so those assets render black-on-black unless the markup is
 *   inlined into the DOM (see `InlineSvg`).
 *
 * Note there is deliberately no `@assets/*` entry in tsconfig `paths`: a real
 * path mapping would resolve to a file TypeScript cannot type, which beats
 * these wildcards and fails. Vite still resolves the alias at build time.
 */

declare module '*.svg' {
  const url: string;
  export default url;
}

declare module '*.svg?raw' {
  const source: string;
  export default source;
}
