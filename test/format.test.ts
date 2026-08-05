import { describe, it, expect } from 'vitest';
import { formatBytes } from '../src/renderer/format';

describe('formatBytes', () => {
  it('never puts a decimal on a raw byte count', () => {
    // "7.0 B" is not a thing anyone writes, and a file manager would say "7 B".
    expect(formatBytes(7)).toBe('7 B');
    expect(formatBytes(0)).toBe('0 B');
  });

  it('keeps one decimal below ten, and drops it above', () => {
    expect(formatBytes(4.3 * 1024 ** 3)).toBe('4.3 GB');
    // At three figures the decimal is noise — 847 MB is the useful part.
    expect(formatBytes(847 * 1024 ** 2)).toBe('847 MB');
  });

  it('climbs one unit at a time and stops at TB', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 ** 2)).toBe('1.0 MB');
    // Past a petabyte it just gets a bigger number rather than an invented unit.
    expect(formatBytes(2048 * 1024 ** 4)).toBe('2048 TB');
  });

  it('says nothing when there is no number', () => {
    // Callers render this straight into a sentence; "undefined" must not appear.
    expect(formatBytes(undefined)).toBe('');
  });
});
