import os from 'node:os';
import { describe, it, expect } from 'vitest';
import { machineMemoryMb } from '../src/core/util/machine-memory';
import { DEFAULT_RAM_MB, MAX_RAM_MB, MIN_RAM_MB, RAM_STEP_MB } from '../src/shared/constants';
import { formatRamGb, ramAdvice, recommendedRamMb, safeMaxRamMb } from '../src/shared/memory';

/**
 * What a machine can spare, and what it should be offered.
 *
 * The arithmetic is small; the reason it is tested is that three different
 * places act on it — the slider's bounds, the pack installer's clamp and the
 * launcher's refusal to start — and a disagreement between them shows up as a
 * setting the form accepted and the launch then rejected.
 */

const GB = 1024;

describe('safeMaxRamMb', () => {
  it('leaves the last 2 GB alone on a small machine', () => {
    // Below about 8 GB the absolute headroom is what binds: the OS needs a
    // roughly fixed amount whatever else is going on.
    expect(safeMaxRamMb(4 * GB)).toBe(2 * GB);
    expect(safeMaxRamMb(6 * GB)).toBe(4 * GB);
  });

  it('keeps a quarter of a large machine back', () => {
    // Past 8 GB the proportional rule bites first, because `-Xmx` bounds the
    // heap and the JVM spends another gigabyte or so outside it.
    expect(safeMaxRamMb(16 * GB)).toBe(12 * GB);
    expect(safeMaxRamMb(32 * GB)).toBe(24 * GB);
  });

  it('never answers with something the profile schema would reject', () => {
    // A pack's RAM recommendation is clamped to this before it becomes a
    // profile, so a value outside the schema's bounds would not be a warning —
    // it would be a pack install that dies inside a validator.
    for (let totalMb = 512; totalMb <= 256 * GB; totalMb += 512) {
      const max = safeMaxRamMb(totalMb);
      expect(max).toBeGreaterThanOrEqual(MIN_RAM_MB);
      expect(max).toBeLessThanOrEqual(MAX_RAM_MB);
      expect(max % RAM_STEP_MB).toBe(0);
    }
  });

  it('has no opinion when the machine could not be measured', () => {
    // A launcher that stopped working because `os.totalmem()` did would be a
    // worse bug than the one this guards against.
    expect(safeMaxRamMb(undefined)).toBe(MAX_RAM_MB);
    expect(safeMaxRamMb(0)).toBe(MAX_RAM_MB);
    expect(safeMaxRamMb(Number.NaN)).toBe(MAX_RAM_MB);
  });
});

describe('recommendedRamMb', () => {
  it('scales with the machine', () => {
    expect(recommendedRamMb(4 * GB)).toBe(2 * GB);
    expect(recommendedRamMb(8 * GB)).toBe(4 * GB);
    expect(recommendedRamMb(16 * GB)).toBe(6 * GB);
    expect(recommendedRamMb(32 * GB)).toBe(8 * GB);
  });

  it('stops at 8 GB however big the machine is', () => {
    // Not a limit of the machine — a limit of the heap. Past this the
    // collector's pauses grow faster than the extra room helps.
    expect(recommendedRamMb(64 * GB)).toBe(8 * GB);
    expect(recommendedRamMb(256 * GB)).toBe(8 * GB);
  });

  it('never recommends more than the machine can spare', () => {
    for (let totalMb = 512; totalMb <= 64 * GB; totalMb += 512) {
      expect(recommendedRamMb(totalMb)).toBeLessThanOrEqual(safeMaxRamMb(totalMb));
    }
  });

  it('falls back to the flat default with no machine to ask', () => {
    expect(recommendedRamMb(undefined)).toBe(DEFAULT_RAM_MB);
  });
});

describe('ramAdvice', () => {
  it('is quiet inside what the machine can spare', () => {
    expect(ramAdvice(4 * GB, 16 * GB)).toBe('ok');
    expect(ramAdvice(12 * GB, 16 * GB)).toBe('ok');
  });

  it('warns above that and refuses above the machine itself', () => {
    expect(ramAdvice(13 * GB, 16 * GB)).toBe('tight');
    expect(ramAdvice(17 * GB, 16 * GB)).toBe('over');
  });

  it('counts the memory the machine actually reports, not the number on the box', () => {
    // A "16 GB" machine answers with a little under that — firmware and the
    // integrated GPU take their share first — so a profile set to a round
    // 16384 really is asking for more than exists.
    const reported = 16270;
    expect(ramAdvice(16 * GB, reported)).toBe('over');
    // And the ceiling moves with it: a quarter of 16270 is not a quarter of
    // 16384, so a round 12 GB is over the line on a machine of this size.
    expect(safeMaxRamMb(reported)).toBe(11776);
    expect(ramAdvice(12 * GB, reported)).toBe('tight');
    expect(ramAdvice(8 * GB, reported)).toBe('ok');
  });

  it('says nothing when the machine could not be measured', () => {
    expect(ramAdvice(32 * GB, undefined)).toBe('ok');
  });
});

describe('formatRamGb', () => {
  it('reads the way the renderer writes every other size', () => {
    expect(formatRamGb(6 * GB)).toBe('6.0 GB');
    expect(formatRamGb(1536)).toBe('1.5 GB');
    // Above ten the decimal is noise, and this is where machine totals land.
    expect(formatRamGb(16270)).toBe('16 GB');
  });
});

describe('machineMemoryMb', () => {
  it('answers in megabytes, which is the unit everything above it assumes', () => {
    // The one thing worth pinning about a `totalmem() / 1024 / 1024`: every
    // consumer — the slider bounds, the advice, the launch refusal — reads this
    // as MB, and a division dropped in a refactor turns a 16 GB machine into a
    // 16-million-megabyte one that agrees with every bound it is checked against.
    const mb = machineMemoryMb();
    expect(Number.isInteger(mb)).toBe(true);
    expect(mb).toBeGreaterThan(256);
    expect(mb).toBeLessThan(os.totalmem() / 1000);
  });

  it('produces a ceiling this machine could actually honour', () => {
    // The composition the RAM slider is: measure, then decide what to offer.
    const max = safeMaxRamMb(machineMemoryMb());
    expect(max).toBeGreaterThanOrEqual(MIN_RAM_MB);
    expect(max).toBeLessThan(machineMemoryMb());
    expect(max % RAM_STEP_MB).toBe(0);
  });
});
