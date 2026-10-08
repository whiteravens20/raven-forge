// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import fs from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic } from '../util/atomic-file';
import type { Library } from './types';

/**
 * The log4j configuration a game old enough to need one is started with.
 *
 * Every log4j from 2.0-beta9 to 2.14.1 performs lookups on the *message* it is
 * printing, so a chat line containing `${jndi:ldap://…}` — from any player on
 * any server — is resolved by the client that logs it. That is Log4Shell
 * (CVE-2021-44228), and it covers Minecraft 1.7.2 to 1.18.
 *
 * Mojang did not rebuild those releases. Its fix is a configuration file handed
 * to the game with `-Dlog4j.configurationFile=`, named under `logging.client`
 * in the version meta — which this launcher typed, merged, and never passed on.
 * They ran with the configuration inside their own jar, which says plain `%msg`.
 *
 * The files here are the launcher's own rather than Mojang's because Mojang's
 * also switch the console to an XML layout, for a log window its launcher has
 * and this one does not: every line would then reach `detectLogLevel` as markup.
 * These keep the half of Mojang's files that is the fix, and print the line the
 * game's own configuration prints.
 */

/**
 * For log4j older than 2.7, which has no way to switch lookups off: any message
 * that contains a `${…}` is not logged at all. The expression is the one in
 * Mojang's `client-1.7.xml`.
 */
const REGEX_FILTER_CONFIG = `<?xml version="1.0" encoding="UTF-8"?>
<Configuration status="WARN">
    <Appenders>
        <Console name="SysOut" target="SYSTEM_OUT">
            <PatternLayout pattern="[%d{HH:mm:ss}] [%t/%level]: %msg%n" />
        </Console>
        <RollingRandomAccessFile name="File" fileName="logs/latest.log" filePattern="logs/%d{yyyy-MM-dd}-%i.log.gz">
            <PatternLayout pattern="[%d{HH:mm:ss}] [%t/%level]: %msg%n" />
            <Policies>
                <TimeBasedTriggeringPolicy />
                <OnStartupTriggeringPolicy />
            </Policies>
        </RollingRandomAccessFile>
    </Appenders>
    <Loggers>
        <Root level="info">
            <filters>
                <MarkerFilter marker="NETWORK_PACKETS" onMatch="DENY" onMismatch="NEUTRAL" />
                <RegexFilter regex="(?s).*\\$\\{[^}]*\\}.*" onMatch="DENY" onMismatch="NEUTRAL" />
            </filters>
            <AppenderRef ref="SysOut" />
            <AppenderRef ref="File" />
        </Root>
    </Loggers>
</Configuration>
`;

/**
 * For log4j 2.7 to 2.14.1: the message is printed as it is, `${…}` and all, and
 * nothing in it is looked up. Both layouts say so — Mojang's `client-1.12.xml`
 * needs it on the file alone, because its console is not a pattern layout.
 */
const NO_LOOKUPS_CONFIG = `<?xml version="1.0" encoding="UTF-8"?>
<Configuration status="WARN">
    <Appenders>
        <Console name="SysOut" target="SYSTEM_OUT">
            <PatternLayout pattern="[%d{HH:mm:ss}] [%t/%level]: %msg{nolookups}%n" />
        </Console>
        <RollingRandomAccessFile name="File" fileName="logs/latest.log" filePattern="logs/%d{yyyy-MM-dd}-%i.log.gz">
            <PatternLayout pattern="[%d{HH:mm:ss}] [%t/%level]: %msg{nolookups}%n" />
            <Policies>
                <TimeBasedTriggeringPolicy />
                <OnStartupTriggeringPolicy />
            </Policies>
        </RollingRandomAccessFile>
    </Appenders>
    <Loggers>
        <Root level="info">
            <filters>
                <MarkerFilter marker="NETWORK_PACKETS" onMatch="DENY" onMismatch="NEUTRAL" />
            </filters>
            <AppenderRef ref="SysOut" />
            <AppenderRef ref="File" />
        </Root>
    </Loggers>
</Configuration>
`;

export type Log4jFix = 'regex-filter' | 'no-lookups';

const CONFIGS: Record<Log4jFix, { fileName: string; body: string }> = {
  'regex-filter': { fileName: 'client-regex-filter.xml', body: REGEX_FILTER_CONFIG },
  'no-lookups': { fileName: 'client-no-lookups.xml', body: NO_LOOKUPS_CONFIG },
};

const LOG4J_CORE = 'org.apache.logging.log4j:log4j-core:';

/**
 * Which configuration these libraries need, or null when their log4j is safe
 * as it ships.
 *
 * Read off the log4j that is actually going to be loaded rather than off the
 * Minecraft version, because the two part ways under a loader: a Forge build
 * that ships a fixed log4j needs nothing, and that same build's own logging
 * setup is worth leaving alone.
 *
 * Every `log4j-core` in the list is considered and the oldest decides. A
 * version that cannot be read counts as the oldest there is: the filter works
 * on every log4j 2, and the cost of applying it where it was not needed is a
 * few log lines, while the cost of the opposite mistake is the whole point.
 */
export function log4jFixFor(libraries: ReadonlyArray<Pick<Library, 'name'>>): Log4jFix | null {
  let fix: Log4jFix | null = null;
  for (const { name } of libraries) {
    if (!name.startsWith(LOG4J_CORE)) continue;
    // `2.0-beta9`, `2.8.1`, `2.14.1` — the first two numbers are all it takes.
    const [major, minor] = name
      .slice(LOG4J_CORE.length)
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);
    if (major > 2 || (major === 2 && minor >= 15)) continue;
    if (major === 2 && minor >= 7) fix ??= 'no-lookups';
    else fix = 'regex-filter';
  }
  return fix;
}

/**
 * The JVM argument that applies the fix these libraries need, with the file it
 * names in place — or undefined when they need none.
 *
 * The file is written from the text above rather than shipped beside the code,
 * and it is compared before it is trusted: what is in `dir` may be from an
 * older build of the launcher, or cut short, and this is the one file whose
 * contents decide whether the fix is applied at all. Left alone when it already
 * matches, so a launch does not replace a file another running game was started
 * with.
 */
export async function log4jConfigArgument(
  dir: string,
  libraries: ReadonlyArray<Pick<Library, 'name'>>,
): Promise<string | undefined> {
  const fix = log4jFixFor(libraries);
  if (!fix) return undefined;

  const { fileName, body } = CONFIGS[fix];
  const file = path.join(dir, fileName);
  const existing = await fs.readFile(file, 'utf-8').catch(() => null);
  if (existing !== body) await writeFileAtomic(file, body);
  return `-Dlog4j.configurationFile=${file}`;
}
