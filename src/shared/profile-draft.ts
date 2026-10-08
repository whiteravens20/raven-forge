// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { MAX_RAM_MB, MIN_RAM_MB } from './constants';

/**
 * What the profile form checks before it lets Save be pressed.
 *
 * The same three bounds the profile schema has, restated without the schema
 * library so that the renderer can ask them. The form had none of them: an
 * address with no scheme, a port of 70000 or an emptied memory box went to the
 * main process, which refused the profile — and the form closed as if it had
 * been saved. The main process still has the last word; this is so that the
 * usual mistakes are answered beside the field, in the player's language.
 */

/** An address a manifest can be fetched from: something that parses, over http(s). */
export function isManifestUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:' || url.protocol === 'http:';
}

export function isServerPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

export function isAllocatableRam(valueMb: number): boolean {
  return Number.isFinite(valueMb) && valueMb >= MIN_RAM_MB && valueMb <= MAX_RAM_MB;
}
