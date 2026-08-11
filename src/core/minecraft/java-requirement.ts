import { JAVA_VERSION_MAP } from '../../shared/constants';
import type { VersionMeta } from './types';

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
