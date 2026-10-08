// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

/**
 * `electron-log`, for a suite that must not write a log.
 *
 * Outside Electron the real one settles on a file of its own accord:
 * `<config>/<productName>/logs/main.log`, which is the launcher's own folder on
 * whatever machine the tests run on. Every line logged by code under test, in
 * any file that had not replaced `src/main/logger`, was appended there — to the
 * log of the launcher somebody actually plays with, between the lines of their
 * last session. Nothing called `initLogger` to say otherwise, and nothing could
 * have: the path it sets comes from the data root the tests move about.
 *
 * So the library is not loaded at all (see vitest.config.mts), and what stands
 * in for it writes nowhere. Nothing under test reads what the logger does with
 * a line; the files that care what was logged replace `src/main/logger` and
 * keep the calls.
 */
const say = (): void => {};

const log = {
  error: say,
  warn: say,
  info: say,
  verbose: say,
  debug: say,
  silly: say,
  log: say,
  // What `initLogger` configures. Plain objects: setting a field on them is all
  // it does, and none of it has anywhere to take effect.
  transports: { file: {} as Record<string, unknown>, console: {} as Record<string, unknown> },
  hooks: [] as unknown[],
  functions: {},
};

export default log;
