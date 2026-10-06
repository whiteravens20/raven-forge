// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { t } from './i18n';
import { useNoticeStore } from './stores/notice-store';
import type { IpcResult } from '@shared/ipc-types';

const api = window.ravenforge;

/** Say so when the system would not open what it was asked to. */
function report(result: IpcResult<unknown>, what: string): boolean {
  if (result.success) return true;
  useNoticeStore
    .getState()
    .show(
      result.error
        ? `${t('common.openFailed', { what })} ${result.error}`
        : t('common.openFailed', { what }),
    );
  return false;
}

/** Open a web address in the system's browser. */
export async function openLink(url: string): Promise<boolean> {
  return report(await api.system.openUrl(url), url);
}

/** Open a folder — or a file — of the launcher's own in the system's file manager. */
export async function openPath(target: string): Promise<boolean> {
  return report(await api.system.openPath(target), target);
}

/** Open a profile's folder. */
export async function openProfileFolder(profileId: string, name: string): Promise<boolean> {
  return report(await api.profiles.openFolder(profileId), name);
}
