// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import raven from '@assets/profile-icons/raven.webp';
import anvil from '@assets/profile-icons/anvil.webp';
import pickaxe from '@assets/profile-icons/pickaxe.webp';
import ember from '@assets/profile-icons/ember.webp';
import diamond from '@assets/profile-icons/diamond.webp';
import shield from '@assets/profile-icons/shield.webp';
import compass from '@assets/profile-icons/compass.webp';
import potion from '@assets/profile-icons/potion.webp';

/**
 * Built-in profile avatars, keyed by the id stored in `Profile.iconPreset`.
 *
 * Each ships its own colour, so they render through `<img>` and need no
 * inlining. An unknown id resolves to `undefined` and the caller falls back to
 * initials — a profile pointing at a preset that a later version dropped must
 * not break.
 */
export const PROFILE_PRESETS: Record<string, string> = {
  raven,
  anvil,
  pickaxe,
  ember,
  diamond,
  shield,
  compass,
  potion,
};

export const PROFILE_PRESET_IDS = Object.keys(PROFILE_PRESETS);
