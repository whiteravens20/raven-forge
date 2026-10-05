// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { useEffect, useState } from 'react';
import type { InstalledMod, ProjectDetails } from '@shared/ipc-types';

const api = window.ravenforge;

/**
 * The name Modrinth would know an installed entry by.
 *
 * Usually its id, which is a project id when the launcher installed it and a
 * slug when a pack manifest did. A jar dropped in by hand has neither — but an
 * update check recognises it by its contents and writes down the project it
 * turned out to be, and that is the better name where there is one.
 */
export function projectKey(entry: InstalledMod): string {
  return entry.updateAvailable?.projectId ?? entry.id;
}

/**
 * Descriptions, icons and page addresses for a list of installed content.
 *
 * Keyed by {@link projectKey}. Entries Modrinth does not know are absent, and
 * so is everything until the lookup answers — the list is drawn from what the
 * profile itself records and filled in when this arrives, never held back for
 * it.
 */
export function useProjectDetails(entries: InstalledMod[]): Record<string, ProjectDetails> {
  const [details, setDetails] = useState<Record<string, ProjectDetails>>({});
  // A string, so the effect below runs when the set of names changes and not
  // every time the list is re-read into a new array holding the same things.
  const signature = entries.map(projectKey).join('\n');

  useEffect(() => {
    if (signature === '') {
      setDetails({});
      return;
    }
    let cancelled = false;
    void api.mods.getDetails(signature.split('\n')).then((reply) => {
      if (!cancelled && reply.success && reply.data) setDetails(reply.data);
    });
    return () => {
      cancelled = true;
    };
  }, [signature]);

  return details;
}
