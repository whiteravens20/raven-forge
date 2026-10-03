// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import type { RavenForgeAPI } from '../shared/ipc-types';

declare global {
  interface Window {
    ravenforge: RavenForgeAPI;
  }
}
