import { describe, it, expect } from 'vitest';
import { privacyPolicyUrl } from '../src/shared/branding';

/**
 * The policy is published once per UI language, so the link out of the app has
 * to resolve to the one the reader can actually read — sending a Polish player
 * to the English file is the same failure as never having translated it.
 *
 * That every locale *has* a file is enforced by the compiler, in the
 * `Record<Locale, string>` behind this function. What is checked here is that
 * the addresses it builds are distinct and point where the documents live.
 */

describe('privacyPolicyUrl', () => {
  it('sends each language to its own document', () => {
    expect(privacyPolicyUrl('pl')).toContain('/docs/PRIVACY.pl.md');
    expect(privacyPolicyUrl('en')).toContain('/docs/PRIVACY.md');
    expect(privacyPolicyUrl('en')).not.toContain('.pl.');
  });

  it('builds an address on the launcher repository', () => {
    expect(privacyPolicyUrl('pl')).toMatch(
      /^https:\/\/github\.com\/whiteravens20\/raven-forge\/blob\/main\/docs\//,
    );
  });
});
