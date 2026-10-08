// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect } from 'vitest';
import { detectLogLevel, withoutColourCodes } from '../src/core/minecraft/game-launcher';

/**
 * Which lines of the game's output count as problems.
 *
 * The log filter reads this, and a false positive is the expensive direction:
 * before, any line merely *containing* "error" or "warn" was flagged, so a
 * perfectly healthy startup showed as a wall of red and the filter became
 * useless for finding the one line that mattered.
 */
describe('detectLogLevel', () => {
  it('reads the level out of the thread tag Minecraft writes', () => {
    expect(detectLogLevel('[15:04:22] [Render thread/ERROR] [minecraft/Minecraft]: boom')).toBe(
      'error',
    );
    expect(detectLogLevel('[15:04:22] [main/WARN] [FabricLoader]: mixin conflict')).toBe('warn');
    expect(
      detectLogLevel('[15:04:22] [main/INFO] [minecraft/Minecraft]: Setting user: Raven'),
    ).toBe('info');
  });

  it('treats FATAL as an error', () => {
    expect(detectLogLevel('[12:00:00] [main/FATAL] [net.minecraft]: unrecoverable')).toBe('error');
  });

  it('accepts the bare bracketed form some mods use', () => {
    expect(detectLogLevel('[ERROR] Could not load config')).toBe('error');
    expect(detectLogLevel('[WARN] Deprecated option')).toBe('warn');
  });

  it('does not flag a line that only mentions the word', () => {
    expect(detectLogLevel('[15:04:22] [main/INFO]: Loaded mod ErrorHandler 2.1')).toBe('info');
    expect(detectLogLevel('[15:04:22] [main/INFO]: Startup finished with no errors')).toBe('info');
    expect(detectLogLevel('  at com.example.errorreporting.Warnings.init(Warnings.java:12)')).toBe(
      'info',
    );
  });

  it('treats an unlabelled line as ordinary output', () => {
    expect(detectLogLevel('Picked up JAVA_TOOL_OPTIONS: -Dfile.encoding=UTF-8')).toBe('info');
    expect(detectLogLevel('')).toBe('info');
  });
});

describe('withoutColourCodes', () => {
  const ESC = String.fromCharCode(27);

  it('takes the colour codes Forge 1.14.4 writes out of a line', () => {
    // As the game sent it: reset, green, the line.
    const raw = `${ESC}[m${ESC}[32m[18:50:57] [Client thread/INFO] [minecraft/Minecraft]: Setting user: Raven`;

    expect(withoutColourCodes(raw)).toBe(
      '[18:50:57] [Client thread/INFO] [minecraft/Minecraft]: Setting user: Raven',
    );
  });

  it('takes out a code with more than one number in it', () => {
    expect(withoutColourCodes(`${ESC}[1;31m[18:51:13] [Thread-1/FATAL]: boom${ESC}[0m`)).toBe(
      '[18:51:13] [Thread-1/FATAL]: boom',
    );
  });

  it('leaves a line that only looks like one alone', () => {
    const line = '[18:51:13] [main/INFO]: slots [32m] and [0m] are free';

    expect(withoutColourCodes(line)).toBe(line);
  });
});
