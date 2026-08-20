import { JAVA_VERSION_MAP } from '../../shared/constants';
import type { VersionMeta } from './types';

/**
 * The Java major version a binary reports, or null when it is not a JVM.
 *
 * `java -version` writes to *stderr*, and says one of two things: Java 8 and
 * older report `1.8.0_392`, everything since reports `21.0.2`. Both forms have
 * to be read, because both are runtimes this launcher will be asked to use —
 * 1.8 needs the first and 1.21 the second.
 *
 * Lives here rather than beside the code that runs the binary so it can be
 * tested against real output without a JVM on the machine running the test.
 */
export function parseJavaVersion(stderr: string): number | null {
  const match = stderr.match(/version "(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  const major = parseInt(match[1], 10);
  // `1.8.0_392` is Java 8; the leading 1 is the era, not the version.
  const version = major === 1 ? parseInt(match[2], 10) : major;
  return Number.isInteger(version) ? version : null;
}

/**
 * The Java major version a Minecraft version needs.
 *
 * Mojang states this in the version meta from 1.17 onward, and that is always
 * the authority. The table is the fallback for older versions, which say
 * nothing — and for the case that matters most, since running 1.8 on Java 21
 * fails in ways that look like anything but a Java version problem.
 *
 * The Forge and NeoForge installers need this too: they are modern Java
 * applications, and the version the game wants is the right floor for them.
 */
export function requiredJavaFor(
  mcVersion: string,
  meta?: Pick<VersionMeta, 'javaVersion'>,
): number {
  // `meta` is JSON off the network. The type annotation on `majorVersion` is a
  // claim about that JSON, not a check of it, and this number is not inert: it
  // becomes the directory in `jre-<n>/bin/java`, which the launcher then
  // executes on every launch, and the version in the Adoptium download URL. A
  // version meta that said `../../../something` would be choosing the binary we
  // run. Re-derive it as an integer and require a Java release that exists.
  const stated = meta?.javaVersion?.majorVersion;
  if (
    typeof stated === 'number' &&
    Number.isInteger(stated) &&
    stated >= OLDEST_JAVA &&
    stated <= NEWEST_PLAUSIBLE_JAVA
  ) {
    return stated;
  }

  const parts = mcVersion.split('.');
  return JAVA_VERSION_MAP[`${parts[0]}.${parts[1]}`] ?? 21;
}

/** Minecraft has never asked for anything older; 1.8 wants exactly this. */
const OLDEST_JAVA = 8;

/**
 * Not a supported-version list — a sanity bound. Java ships a release every six
 * months, so this holds until roughly 2060 and never has to be edited to keep a
 * new version working; anything past it is a malformed or hostile version meta.
 */
const NEWEST_PLAUSIBLE_JAVA = 99;
