import { createRequire } from 'node:module';
import type * as KeytarModule from 'keytar';
import { log } from '../../main/logger';
import { APP_ID } from '../../shared/constants';

/**
 * OS keychain access for long-lived credentials.
 *
 * keytar talks to Credential Manager on Windows, Keychain on macOS, and
 * libsecret/kwallet over D-Bus on Linux. Linux is the case that actually fails
 * in the field — a box with no keyring daemon, a headless session, or a locked
 * keyring throws at *call* time, not load time, so both are guarded.
 *
 * Nothing here throws. A failure reports itself in the return value and the
 * caller decides what to do; for the launcher that means falling back to the
 * on-disk store rather than making Microsoft login impossible on such a
 * machine.
 */

/** Keychain service name; one entry per account lives under it. */
const SERVICE = APP_ID;

type Keytar = typeof KeytarModule;

// Loaded through createRequire rather than a top-level import so a broken or
// missing native binding degrades instead of taking the whole main process
// down on startup. The import above is type-only and erases at compile time.
const requireNative = createRequire(__filename);

/** `undefined` = not attempted yet, `null` = attempted and unusable. */
let cached: Keytar | null | undefined;

function keytar(): Keytar | null {
  if (cached !== undefined) return cached;
  try {
    cached = requireNative('keytar') as Keytar;
  } catch (err) {
    log.warn('OS keychain unavailable — keytar failed to load:', err);
    cached = null;
  }
  return cached;
}

/**
 * Store a secret.
 *
 * @returns `true` when it reached the keychain. `false` means the caller is
 *          responsible for persisting it some other way.
 */
export async function setSecret(key: string, value: string): Promise<boolean> {
  const kt = keytar();
  if (!kt) return false;
  try {
    await kt.setPassword(SERVICE, key, value);
    return true;
  } catch (err) {
    log.warn(`OS keychain write failed for "${key}":`, err);
    return false;
  }
}

/** Read a secret. `null` covers both "not stored" and "keychain unreachable". */
export async function getSecret(key: string): Promise<string | null> {
  const kt = keytar();
  if (!kt) return null;
  try {
    return await kt.getPassword(SERVICE, key);
  } catch (err) {
    log.warn(`OS keychain read failed for "${key}":`, err);
    return null;
  }
}

/** Best-effort delete — a credential we cannot reach is one we cannot remove. */
export async function deleteSecret(key: string): Promise<void> {
  const kt = keytar();
  if (!kt) return;
  try {
    await kt.deletePassword(SERVICE, key);
  } catch (err) {
    log.warn(`OS keychain delete failed for "${key}":`, err);
  }
}
