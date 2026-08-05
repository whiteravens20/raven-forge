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
  if (meta?.javaVersion?.majorVersion) return meta.javaVersion.majorVersion;

  const parts = mcVersion.split('.');
  return JAVA_VERSION_MAP[`${parts[0]}.${parts[1]}`] ?? 21;
}
