// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { afterGameWhenClosed, windowlessJava } from '../src/core/minecraft/game-launcher';

/**
 * "When the game starts: close", from the far end.
 *
 * The setting used to close the window when the game *exited*, from a handler
 * registered ahead of the one that records the session — so the launcher stayed
 * open all through the game, and after a crash it was gone before the crash
 * card could be drawn. Now the window is hidden at launch and this decides what
 * happens to the hidden launcher once the session is on record.
 */
describe('afterGameWhenClosed', () => {
  const hidden = { crashed: false, windowVisible: false, othersRunning: false };

  it('quits after a game that simply ended', () => {
    expect(afterGameWhenClosed(hidden)).toBe('quit');
  });

  it('comes back for a crash, so the report can be seen', () => {
    expect(afterGameWhenClosed({ ...hidden, crashed: true })).toBe('show');
  });

  it('comes back for a crash whatever else is true', () => {
    expect(afterGameWhenClosed({ crashed: true, windowVisible: true, othersRunning: true })).toBe(
      'show',
    );
  });

  it('does not quit under a player who opened the launcher again', () => {
    expect(afterGameWhenClosed({ ...hidden, windowVisible: true })).toBe('stay');
  });

  it('does not quit while another game still has a session to record', () => {
    expect(afterGameWhenClosed({ ...hidden, othersRunning: true })).toBe('stay');
  });
});

/**
 * Which binary the game is started with on Windows.
 *
 * `java.exe` there is a console program, and a launcher without a console makes
 * Windows open one for it: a black window for as long as the game runs.
 */
describe('windowlessJava', () => {
  let bin: string;

  beforeEach(async () => {
    bin = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-javaw-'));
  });

  afterEach(async () => {
    await fs.rm(bin, { recursive: true, force: true });
  });

  it('takes javaw.exe when it is beside java.exe', async () => {
    await fs.writeFile(path.join(bin, 'javaw.exe'), '');
    expect(await windowlessJava(path.join(bin, 'java.exe'), 'win32')).toBe(
      path.join(bin, 'javaw.exe'),
    );
  });

  it('keeps java.exe when there is nothing else to start', async () => {
    expect(await windowlessJava(path.join(bin, 'java.exe'), 'win32')).toBe(
      path.join(bin, 'java.exe'),
    );
  });

  it('leaves alone a runtime the player pointed somewhere else', async () => {
    await fs.writeFile(path.join(bin, 'javaw.exe'), '');
    const chosen = path.join(bin, 'my-java-wrapper.exe');
    expect(await windowlessJava(chosen, 'win32')).toBe(chosen);
  });

  it('changes nothing where there is no such thing as a console window', async () => {
    await fs.writeFile(path.join(bin, 'javaw.exe'), '');
    expect(await windowlessJava(path.join(bin, 'java.exe'), 'linux')).toBe(
      path.join(bin, 'java.exe'),
    );
    expect(await windowlessJava(path.join(bin, 'java'), 'linux')).toBe(path.join(bin, 'java'));
  });
});
