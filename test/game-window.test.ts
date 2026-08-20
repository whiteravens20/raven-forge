import { describe, it, expect } from 'vitest';
import { customResolution } from '../src/core/minecraft/launch-args';
import { profileSchema } from '../src/shared/validators';
import { MAX_GAME_DIMENSION, MIN_GAME_HEIGHT, MIN_GAME_WIDTH } from '../src/shared/constants';

/**
 * The window a profile asks the game for.
 *
 * Two rules meet here and neither is obvious from the field names. Mojang gates
 * `--width` and `--height` behind one `has_custom_resolution` feature, so half
 * a size is no size at all; and `profiles.json` is read back without being
 * validated, so the launcher cannot assume the schema ever saw these numbers.
 */
describe('customResolution', () => {
  it('takes a size only as a pair', () => {
    expect(customResolution(1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(customResolution(1920, undefined)).toBeNull();
    expect(customResolution(undefined, 1080)).toBeNull();
    expect(customResolution(undefined, undefined)).toBeNull();
  });

  it('refuses a size the game would not make', () => {
    expect(customResolution(MIN_GAME_WIDTH, MIN_GAME_HEIGHT)).not.toBeNull();
    expect(customResolution(MIN_GAME_WIDTH - 1, MIN_GAME_HEIGHT)).toBeNull();
    expect(customResolution(MIN_GAME_WIDTH, MIN_GAME_HEIGHT - 1)).toBeNull();
    expect(customResolution(MAX_GAME_DIMENSION + 1, 1080)).toBeNull();
  });

  it('refuses a number that is not a whole pixel count', () => {
    // `String(1920.5)` would reach the game as `--width 1920.5`, which it
    // cannot parse — and a launch that dies in argument parsing says nothing
    // about a window size.
    expect(customResolution(1920.5, 1080)).toBeNull();
    expect(customResolution(Number.NaN, 1080)).toBeNull();
  });
});

describe('the profile schema and the window', () => {
  const base = {
    id: 'p1',
    name: 'Ravens',
    minecraftVersion: '1.21.4',
    modLoader: 'fabric' as const,
    allocatedRamMb: 4096,
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
  };

  it('keeps a size it can use', () => {
    const parsed = profileSchema.parse({ ...base, windowWidth: 1920, windowHeight: 1080 });
    expect(parsed.windowWidth).toBe(1920);
    expect(parsed.windowHeight).toBe(1080);
  });

  it('drops an impossible size instead of refusing the profile', () => {
    // Every play session ends in an `updateProfile`, which runs the whole
    // profile through this schema. A file hand-edited to a 12-pixel window must
    // not become a profile whose play time can never be recorded again.
    const parsed = profileSchema.parse({ ...base, windowWidth: 12, windowHeight: 12 });
    expect(parsed.windowWidth).toBeUndefined();
    expect(parsed.windowHeight).toBeUndefined();
    expect(parsed.name).toBe('Ravens');
  });

  it('drops a full-screen value that is not a yes or a no', () => {
    expect(profileSchema.parse({ ...base, fullscreen: 'yes' }).fullscreen).toBeUndefined();
  });

  it('still refuses the fields a launch depends on', () => {
    // The forgiving treatment above is for a window size and nothing else.
    expect(() => profileSchema.parse({ ...base, allocatedRamMb: 1 })).toThrow();
    expect(() => profileSchema.parse({ ...base, minecraftVersion: '../../etc' })).toThrow();
  });
});
