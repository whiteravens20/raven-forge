import { describe, it, expect } from 'vitest';
import { detectLogLevel } from '../src/core/minecraft/game-launcher';

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
