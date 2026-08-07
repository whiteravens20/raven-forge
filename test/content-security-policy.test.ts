import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CONTENT_SECURITY_POLICY } from '../src/main/security';

/**
 * The renderer is under two policies at once — the response header and the
 * `<meta>` copy in index.html — and a browser enforces every policy it is
 * given. If the two drift apart the page ends up under their intersection,
 * which is a policy nobody wrote down and nobody reviewed.
 *
 * The likely drift is loosening one and forgetting the other, which reads as
 * "the change had no effect" and gets debugged as something else entirely.
 */
describe('Content-Security-Policy', () => {
  it('is the same in index.html as in the header', () => {
    const html = readFileSync(
      path.resolve(__dirname, '../src/renderer/index.html'),
      'utf-8',
    ).replace(/\s+/g, ' ');
    const meta = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);

    expect(meta?.[1]).toBe(CONTENT_SECURITY_POLICY);
  });

  it('allows no inline script in the policy that ships', () => {
    // The dev server gets `'unsafe-inline'` so Vite's refresh preamble runs;
    // this is the assertion that the relaxation stays on that side of the line.
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self';");
    expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe-eval');
    expect(CONTENT_SECURITY_POLICY.split('; ')).not.toContain("script-src 'self' 'unsafe-inline'");
  });
});
