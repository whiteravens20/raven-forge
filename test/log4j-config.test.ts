// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { log4jConfigArgument, log4jFixFor } from '../src/core/minecraft/log4j-config';
import { detectLogLevel } from '../src/core/minecraft/game-launcher';

/**
 * Which games are started with a logging configuration, and what it says.
 *
 * Everything from Minecraft 1.7.2 to 1.18 logs through a log4j that resolves
 * `${jndi:…}` in a chat line (Log4Shell). Whether the fix is applied is decided
 * here from a version string, and a wrong answer is invisible in both
 * directions: the game starts and plays exactly the same either way.
 */

const core = (version: string) => ({ name: `org.apache.logging.log4j:log4j-core:${version}` });

describe('log4jFixFor', () => {
  it.each([
    // The log4j each of these releases really lists.
    ['1.7.10 and 1.8.9', '2.0-beta9', 'regex-filter'],
    ['1.12.2 and 1.16.5', '2.8.1', 'no-lookups'],
    ['1.17.1', '2.14.1', 'no-lookups'],
    ['1.18.2', '2.17.0', null],
    ['1.20.1', '2.19.0', null],
    ['1.21.4', '2.24.1', null],
  ])('reads Minecraft %s, on log4j %s, as %s', (_release, version, fix) => {
    expect(log4jFixFor([core(version)])).toBe(fix);
  });

  it('draws the lines where log4j drew them', () => {
    // `%msg{nolookups}` arrived in 2.7; before it the option is silently ignored
    // and lookups stay on. 2.15 is the first release that does none by default.
    expect(log4jFixFor([core('2.6.2')])).toBe('regex-filter');
    expect(log4jFixFor([core('2.7')])).toBe('no-lookups');
    expect(log4jFixFor([core('2.14.1')])).toBe('no-lookups');
    expect(log4jFixFor([core('2.15.0')])).toBeNull();
    expect(log4jFixFor([core('3.0.0')])).toBeNull();
  });

  it('has nothing to fix in a game that does not use log4j', () => {
    // 1.6.4 and older.
    expect(log4jFixFor([{ name: 'net.sf.jopt-simple:jopt-simple:4.5' }])).toBeNull();
    expect(log4jFixFor([])).toBeNull();
  });

  it('judges by log4j-core alone, which is where the lookups are', () => {
    expect(
      log4jFixFor([
        { name: 'org.apache.logging.log4j:log4j-api:2.8.1' },
        { name: 'org.apache.logging.log4j:log4j-slf4j18-impl:2.14.1' },
        core('2.17.0'),
      ]),
    ).toBeNull();
  });

  it('lets the oldest log4j on the list decide, whatever order they come in', () => {
    expect(log4jFixFor([core('2.17.0'), core('2.8.1')])).toBe('no-lookups');
    expect(log4jFixFor([core('2.8.1'), core('2.0-beta9')])).toBe('regex-filter');
    expect(log4jFixFor([core('2.0-beta9'), core('2.8.1')])).toBe('regex-filter');
  });

  it('treats a version it cannot read as the oldest there is', () => {
    // The filter works on every log4j 2; assuming "new enough" does not.
    expect(log4jFixFor([core('LATEST')])).toBe('regex-filter');
  });
});

describe('log4jConfigArgument', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-log4j-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** The file an argument names, read back. */
  async function configOf(argument: string | undefined): Promise<string> {
    expect(argument).toMatch(/^-Dlog4j\.configurationFile=/);
    return fs.readFile(argument!.slice('-Dlog4j.configurationFile='.length), 'utf-8');
  }

  it('gives the oldest log4j a configuration that refuses to log a lookup', async () => {
    const config = await configOf(await log4jConfigArgument(dir, [core('2.0-beta9')]));
    // Mojang's own expression: any message with a `${…}` in it is dropped.
    expect(config).toContain(
      '<RegexFilter regex="(?s).*\\$\\{[^}]*\\}.*" onMatch="DENY" onMismatch="NEUTRAL" />',
    );
  });

  it('gives the later ones a configuration that prints the message untouched', async () => {
    const config = await configOf(await log4jConfigArgument(dir, [core('2.8.1')]));
    // Every layout, not just the file's: this console is a pattern layout too,
    // and a plain `%msg` anywhere is one place the lookup still happens.
    expect(config.match(/%msg\{nolookups\}/g)).toHaveLength(2);
    expect(config).not.toMatch(/%msg(?!\{nolookups\})/);
    expect(config).not.toContain('RegexFilter');
  });

  it.each(['2.0-beta9', '2.8.1'])(
    'keeps the console line of log4j %s one the log filter can read',
    async (version) => {
      const config = await configOf(await log4jConfigArgument(dir, [core(version)]));
      const pattern = /<Console [^>]*>\s*<PatternLayout pattern="([^"]+)"/.exec(config)?.[1];
      // What log4j makes of that pattern for one error from the render thread.
      const line = pattern!
        .replace('%d{HH:mm:ss}', '15:04:22')
        .replace('%t', 'Render thread')
        .replace('%level', 'ERROR')
        .replace(/%msg(\{nolookups\})?%n/, 'boom');
      expect(line).toBe('[15:04:22] [Render thread/ERROR]: boom');
      expect(detectLogLevel(line)).toBe('error');
    },
  );

  it('still writes the game’s own log file', async () => {
    for (const version of ['2.0-beta9', '2.8.1']) {
      const config = await configOf(await log4jConfigArgument(dir, [core(version)]));
      expect(config).toContain('fileName="logs/latest.log"');
    }
  });

  it('passes nothing, and writes nothing, for a log4j that is already safe', async () => {
    expect(await log4jConfigArgument(dir, [core('2.24.1')])).toBeUndefined();
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('replaces a file that is not the configuration it should be', async () => {
    // Left by an older build, cut short, or edited: the argument is only a fix
    // if the file it names says what this build means it to say.
    const argument = await log4jConfigArgument(dir, [core('2.8.1')]);
    const file = argument!.slice('-Dlog4j.configurationFile='.length);
    const intended = await fs.readFile(file, 'utf-8');
    await fs.writeFile(file, intended.replaceAll('{nolookups}', ''));

    await log4jConfigArgument(dir, [core('2.8.1')]);

    expect(await fs.readFile(file, 'utf-8')).toBe(intended);
    // Nothing half-written is left beside it.
    expect(await fs.readdir(dir)).toEqual([path.basename(file)]);
  });

  it('leaves a file that is already right exactly where it is', async () => {
    // Another profile's game may have been started with it a moment ago.
    const argument = await log4jConfigArgument(dir, [core('2.8.1')]);
    const file = argument!.slice('-Dlog4j.configurationFile='.length);
    const before = await fs.stat(file);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(await log4jConfigArgument(dir, [core('2.8.1')])).toBe(argument);

    const after = await fs.stat(file);
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });
});
