// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import type { InstalledMod } from '@shared/ipc-types';

/**
 * The installed mods a player is looking for: every word they typed has to be
 * in the mod's name or its file's. A pack runs to a hundred mods and more, and a
 * jar's name is often the one thing somebody has to go by.
 */
export function filterInstalled(mods: InstalledMod[], query: string): InstalledMod[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return mods;
  return mods.filter((mod) => {
    const haystack = `${mod.name} ${mod.fileName}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
