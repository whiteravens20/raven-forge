import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from '../../main/logger';
import { paths } from '../config/paths';
import { getProfile, updateProfile } from './profile-manager';
import type { Profile } from '../../shared/ipc-types';

/**
 * Custom profile artwork.
 *
 * The picked file is copied into the profile's own directory rather than
 * referenced in place — a profile that breaks because the user tidied up their
 * Downloads folder is not acceptable. Copies are read back as data URLs
 * because the renderer's CSP is `img-src 'self' data: https:`, which
 * (deliberately) excludes `file:`.
 */

/** Formats a Chromium `<img>` will render, mapped to their data-URL MIME type. */
const ALLOWED_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

/** An avatar renders at 40px. Anything past this is a mistake, not a choice. */
const MAX_ICON_BYTES = 2 * 1024 * 1024;

const ALLOWED_ICON_EXTENSIONS = Object.keys(ALLOWED_TYPES).map((e) => e.slice(1));

function iconPathFor(profileId: string, ext: string): string {
  return path.join(paths.profileDir(profileId), `icon${ext}`);
}

/**
 * Copy `sourcePath` in as the profile's icon, replacing any previous one.
 * Returns the updated profile.
 */
export async function setProfileIcon(profileId: string, sourcePath: string): Promise<Profile> {
  const profile = await getProfile(profileId);
  if (!profile) throw new Error(`Profile ${profileId} not found`);

  const ext = path.extname(sourcePath).toLowerCase();
  if (!ALLOWED_TYPES[ext]) {
    throw new Error(
      `Unsupported image type "${ext || sourcePath}" — use ${ALLOWED_ICON_EXTENSIONS.join(', ')}`,
    );
  }

  const stat = await fs.stat(sourcePath);
  if (!stat.isFile()) throw new Error('Selected path is not a file');
  if (stat.size > MAX_ICON_BYTES) {
    throw new Error(
      `Image is ${(stat.size / 1024 / 1024).toFixed(1)} MB — the limit is ${MAX_ICON_BYTES / 1024 / 1024} MB`,
    );
  }

  await fs.mkdir(paths.profileDir(profileId), { recursive: true });

  // A previous icon with a different extension would otherwise linger and win
  // nothing but disk space.
  await clearIconFiles(profileId);

  const dest = iconPathFor(profileId, ext);
  await fs.copyFile(sourcePath, dest);

  log.info(`Set icon for profile ${profileId}: ${path.basename(sourcePath)}`);
  return updateProfile(profileId, { iconPath: dest });
}

/** Drop the custom icon and fall back to whatever the UI shows by default. */
export async function clearProfileIcon(profileId: string): Promise<Profile> {
  await clearIconFiles(profileId);
  return updateProfile(profileId, { iconPath: undefined });
}

async function clearIconFiles(profileId: string): Promise<void> {
  await Promise.all(
    Object.keys(ALLOWED_TYPES).map((ext) => fs.rm(iconPathFor(profileId, ext), { force: true })),
  );
}

/**
 * The profile's icon as a `data:` URL, or `null` when it has none — including
 * when the file has gone missing underneath us, which the caller should treat
 * the same as "never had one".
 */
export async function getProfileIconDataUrl(profileId: string): Promise<string | null> {
  const profile = await getProfile(profileId);
  if (!profile?.iconPath) return null;

  const mime = ALLOWED_TYPES[path.extname(profile.iconPath).toLowerCase()];
  if (!mime) return null;

  try {
    const bytes = await fs.readFile(profile.iconPath);
    return `data:${mime};base64,${bytes.toString('base64')}`;
  } catch (err) {
    log.warn(`Profile ${profileId} icon unreadable, ignoring: ${err}`);
    return null;
  }
}
