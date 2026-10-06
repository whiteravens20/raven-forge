// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import type { InstalledMod } from './ipc-types';

/** As much of an installed entry as it takes to say which project it is. */
export type InstalledIdentity = Pick<InstalledMod, 'id'> &
  Partial<Pick<InstalledMod, 'projectId' | 'updateAvailable'>>;

/**
 * Whether an installed entry is the Modrinth project `projectId`.
 *
 * An entry can be known by three names. Something installed from the search has
 * the project id as its own `id`. A pack names its entries as it likes —
 * `fabric-api` — and says which project that is beside it. A jar dropped in by
 * hand has neither, until an update check recognises it by its contents.
 *
 * Only the first used to be compared, so a profile made from a pack was not
 * seen to hold what the pack had put there: installing a mod that needs Fabric
 * API added a second Fabric API beside the pack's, and the shader-loader check
 * offered Iris to a profile that already had it.
 */
export function isProject(mod: InstalledIdentity, projectId: string): boolean {
  return (
    mod.id === projectId ||
    mod.projectId === projectId ||
    mod.updateAvailable?.projectId === projectId
  );
}
