import { useEffect, useState } from 'react';
import { PROFILE_PRESETS } from '@components/profile-presets';
import type { Profile } from '@shared/ipc-types';

const api = window.ravenforge;

/**
 * Icons come over IPC as data URLs, so they are cached per profile to keep a
 * list of profiles from re-encoding the same PNGs on every render. The cache
 * key includes `updatedAt` so replacing an icon invalidates it for free.
 */
const cache = new Map<string, string | null>();

function cacheKey(profile: Profile): string {
  return `${profile.id}:${profile.updatedAt}`;
}

/** Deterministic tint for the fallback, so a profile keeps the same colour. */
const FALLBACK_TINTS = [
  'bg-violet-500/20 text-violet-300',
  'bg-sky-500/20 text-sky-300',
  'bg-emerald-500/20 text-emerald-300',
  'bg-amber-500/20 text-amber-300',
  'bg-rose-500/20 text-rose-300',
  'bg-teal-500/20 text-teal-300',
];

function tintFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return FALLBACK_TINTS[hash % FALLBACK_TINTS.length];
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

interface ProfileAvatarProps {
  profile: Profile;
  size?: number;
  className?: string;
}

export function ProfileAvatar({ profile, size = 40, className = '' }: ProfileAvatarProps) {
  const key = cacheKey(profile);
  const [icon, setIcon] = useState<string | null>(() => cache.get(key) ?? null);

  useEffect(() => {
    if (cache.has(key)) {
      setIcon(cache.get(key) ?? null);
      return;
    }
    // Only a user-supplied image needs the IPC round trip; presets and remote
    // URLs are already resolvable in the renderer.
    if (!profile.iconPath) {
      cache.set(key, null);
      setIcon(null);
      return;
    }

    let active = true;
    void api.profiles.getIcon(profile.id).then((result) => {
      const url = result.success ? (result.data ?? null) : null;
      cache.set(key, url);
      if (active) setIcon(url);
    });
    return () => {
      active = false;
    };
  }, [key, profile.id, profile.iconPath]);

  // A custom upload beats a preset, which beats a remote URL. An unrecognised
  // preset id falls through to initials rather than rendering nothing.
  const preset = profile.iconPreset ? PROFILE_PRESETS[profile.iconPreset] : undefined;
  const src = icon ?? preset ?? profile.iconUrl;
  const dimensions = { width: size, height: size };

  if (src) {
    return (
      <img
        src={src}
        alt=""
        style={dimensions}
        className={`shrink-0 rounded-lg border border-rf-border object-cover ${className}`}
      />
    );
  }

  return (
    <div
      style={{ ...dimensions, fontSize: Math.round(size * 0.36) }}
      className={`flex shrink-0 items-center justify-center rounded-lg border border-rf-border font-display font-semibold ${tintFor(profile.id)} ${className}`}
      aria-hidden="true"
    >
      {initials(profile.name)}
    </div>
  );
}

/** Drop cached icons for one profile — call after changing or clearing it. */
export function invalidateAvatarCache(profileId: string): void {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${profileId}:`)) cache.delete(key);
  }
}
