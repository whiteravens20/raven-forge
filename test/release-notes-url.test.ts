// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect } from 'vitest';
import { releaseNotesUrl } from '../src/shared/branding';

/**
 * "What's new" on an update notice leads to that release's own page.
 *
 * The address is built from the version the updater reports, which carries no
 * `v`; the tag a release is published under does. A link that left it out opens
 * a page that says the release does not exist.
 */

describe('releaseNotesUrl', () => {
  it('names the tag the release was published under', () => {
    expect(releaseNotesUrl('0.8.0')).toBe(
      'https://github.com/whiteravens20/raven-forge/releases/tag/v0.8.0',
    );
  });

  it('keeps a version that is not a plain one inside the address', () => {
    expect(releaseNotesUrl('1.0.0-rc.1')).toMatch(/\/releases\/tag\/v1\.0\.0-rc\.1$/);
    expect(releaseNotesUrl('1.0.0/../../x')).not.toContain('/../');
  });
});
