// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * The suite writes no log.
 *
 * Most files here leave `src/main/logger` as it is, and the code they exercise
 * logs as it goes. With the real `electron-log` behind it, each of those lines
 * was appended to `<config>/Raven Forge Launcher/logs/main.log` on the machine
 * running the tests — the folder of the launcher installed there. This is the
 * check that it stays replaced: take the stand-in out of vitest.config.mts and
 * the line below lands in the folder this test is watching.
 */

let config: string;
let before: string | undefined;

beforeEach(async () => {
  config = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-log-sandbox-'));
  before = process.env.XDG_CONFIG_HOME;
  // Where `electron-log` looks first on Linux, and the test's own to watch.
  process.env.XDG_CONFIG_HOME = config;
});

afterEach(async () => {
  if (before === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = before;
  await fs.rm(config, { recursive: true, force: true });
});

describe.skipIf(process.platform !== 'linux')('the launcher’s logger, under test', () => {
  it('writes nothing to the config folder of the machine the tests run on', async () => {
    const { log } = await import('../src/main/logger');

    log.info('a line from the test suite');
    log.warn('and another');
    log.error(new Error('and what a failure would leave'));

    expect(await fs.readdir(config)).toEqual([]);
  });
});
