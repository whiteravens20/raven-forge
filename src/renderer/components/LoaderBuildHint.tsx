// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { useEffect, useState } from 'react';
import { useT } from '@renderer/i18n';
import { loaderLabel } from '@shared/labels';
import type { Profile } from '@shared/ipc-types';

const api = window.ravenforge;

/**
 * A line under a crash or a failed launch, when the profile's loader build is
 * one the editor's list would not have offered.
 *
 * Such a profile comes from a pack, which names the build it wants and has it
 * installed. When it then does not start, what the loader says about that is
 * accurate and no use to a player — a constructor that is not there, a class
 * file version — and nothing joined it to the one thing they could change.
 *
 * Asked of the main process each time, not carried in the failure: it is a fact
 * about the profile as it stands, so it stops being said once the build has
 * been changed. A pack's own profile is told who can change it, since the next
 * sync would put the pack's build back.
 */
export function LoaderBuildHint({ profile, className }: { profile: Profile; className?: string }) {
  const t = useT();
  const { modLoader, modLoaderVersion, minecraftVersion } = profile;
  const [starts, setStarts] = useState(true);

  useEffect(() => {
    setStarts(true);
    if (modLoader === 'vanilla' || !modLoaderVersion) return;
    let cancelled = false;
    void api.loaders.buildStarts(modLoader, modLoaderVersion, minecraftVersion).then((result) => {
      // No answer is not a finding: only a plain "no" is said out loud.
      if (!cancelled && result.success && result.data === false) setStarts(false);
    });
    return () => {
      cancelled = true;
    };
  }, [modLoader, modLoaderVersion, minecraftVersion]);

  if (starts) return null;

  // A span, because one of the places this goes is inside a banner's own line.
  return (
    <span className={className}>
      {t(profile.manifestUrl ? 'loaderHint.notOfferedPack' : 'loaderHint.notOffered', {
        loader: `${loaderLabel(modLoader)} ${modLoaderVersion}`,
        mcVersion: minecraftVersion,
      })}
    </span>
  );
}
