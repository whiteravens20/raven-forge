// Java runtimes the launcher knows about.
// Part of the IPC contract — see `../ipc-types.ts`.

export interface JavaInstallation {
  version: number;
  path: string;
  vendor: string;
  managed: boolean;
}
