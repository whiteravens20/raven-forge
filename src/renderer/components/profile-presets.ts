import raven from '@assets/profile-icons/raven.svg';
import anvil from '@assets/profile-icons/anvil.svg';
import pickaxe from '@assets/profile-icons/pickaxe.svg';
import ember from '@assets/profile-icons/ember.svg';
import diamond from '@assets/profile-icons/diamond.svg';
import shield from '@assets/profile-icons/shield.svg';
import compass from '@assets/profile-icons/compass.svg';
import potion from '@assets/profile-icons/potion.svg';

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
