// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

// Java runtimes the launcher knows about.
// Part of the IPC contract — see `../ipc-types.ts`.

export interface JavaInstallation {
  version: number;
  path: string;
  vendor: string;
}

/** What a binary a profile was pointed at turned out to be. */
export interface JavaProbe {
  /** Major version, or null when it is not a Java runtime at all. */
  version: number | null;
  /** What the profile's Minecraft version needs, so "too old" can be said on the spot. */
  requiredVersion: number;
}
