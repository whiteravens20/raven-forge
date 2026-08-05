import { describe, it, expect } from 'vitest';
import { updateSupportFor } from '../src/core/updater/launcher-updater';

/**
 * Which builds may replace themselves.
 *
 * The costly mistake here is a false *yes*: letting a `.deb` install overwrite
 * files dpkg is tracking leaves the package database lying about what is on
 * disk, and the next `apt upgrade` either reverts the launcher or fails. A
 * false *no* only means someone updates by hand.
 */
describe('updateSupportFor', () => {
  it('refuses when running from source, on every platform', () => {
    for (const platform of ['win32', 'linux', 'darwin'] as NodeJS.Platform[]) {
      expect(updateSupportFor(false, platform, false)).toBe('development');
    }
  });

  it('allows a packaged Windows build — the NSIS installer is self-updating', () => {
    expect(updateSupportFor(true, 'win32', false)).toBeNull();
  });

  it('allows a Linux AppImage', () => {
    expect(updateSupportFor(true, 'linux', true)).toBeNull();
  });

  it('refuses a Linux install that is not an AppImage', () => {
    // .deb / .rpm: the package manager owns those files.
    expect(updateSupportFor(true, 'linux', false)).toBe('system-package');
  });

  it('refuses macOS, which needs a signed and notarised bundle', () => {
    expect(updateSupportFor(true, 'darwin', false)).toBe('unsigned-platform');
  });

  it('does not let the AppImage marker rescue a non-Linux platform', () => {
    // APPIMAGE should never be set on Windows, but a stray env var must not be
    // what decides whether we overwrite someone's installation.
    expect(updateSupportFor(true, 'win32', true)).toBeNull();
    expect(updateSupportFor(true, 'darwin', true)).toBe('unsigned-platform');
  });

  it('puts development ahead of every platform rule', () => {
    // A dev checkout on Linux is "development", not "system-package" — the
    // message tells the reader something true about their situation.
    expect(updateSupportFor(false, 'linux', false)).toBe('development');
    expect(updateSupportFor(false, 'darwin', true)).toBe('development');
  });
});
