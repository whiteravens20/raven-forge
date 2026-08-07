import { app } from 'electron';
import { REPO_URL } from '../../shared/branding';

/**
 * How the launcher identifies itself to Modrinth.
 *
 * Modrinth's API terms ask for a real project identifier and a contact address,
 * and their rate limiter treats an anonymous agent worse than a named one.
 *
 * The version comes from `app.getVersion()` — that is, from `package.json` at
 * build time — rather than from a constant beside it. There used to be an
 * `APP_VERSION = '0.1.0'` doing this job, a second copy of a number that is
 * already recorded in exactly one authoritative place, and a third copy was
 * hardcoded into the launch arguments. Copies of a version number do not stay
 * equal; the first release that bumps `package.json` alone leaves the launcher
 * telling Modrinth it is something it stopped being.
 */
export function modrinthUserAgent(): string {
  return `whiteravens20/raven-forge/${app.getVersion()} (${REPO_URL})`;
}
