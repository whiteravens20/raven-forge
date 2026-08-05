import type { RavenForgeAPI } from '../shared/ipc-types';

declare global {
  interface Window {
    ravenforge: RavenForgeAPI;
  }
}
