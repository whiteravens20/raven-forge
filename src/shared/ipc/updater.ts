// Manifest signatures and launcher updates.
// Part of the IPC contract — see `../ipc-types.ts`.

/**
 * The outcome of checking a manifest's signature — always about the manifest a
 * profile last *installed*, never about one fetched to answer the question.
 */
export interface ManifestVerification {
  signed: boolean;
  valid: boolean;
  signerName?: string;
  error?: string;
  /**
   * No sync has run, so there is nothing to report on yet. Distinct from
   * `signed: false`, which is a finding about a manifest that was installed.
   */
  neverSynced?: boolean;
}

export interface UpdateInfo {
  version: string;
  releaseNotes?: string;
  releaseDate: string;
  downloadSize?: number;
}

/**
 * The outcome of an update check, as four distinct things rather than one
 * nullable one.
 *
 * `checkForUpdates` used to return `null` for "up to date", "this is a dev
 * build" and "the check failed" alike, which is why nothing could be built on
 * top of it: a UI cannot report what it cannot distinguish, and silently
 * showing "you are up to date" after a failed check is a lie with consequences.
 */
export type UpdateCheck =
  | { status: 'up-to-date'; currentVersion: string }
  | { status: 'available'; currentVersion: string; update: UpdateInfo }
  /** Self-update is not possible for this build — `reason` says why. */
  | { status: 'unsupported'; currentVersion: string; reason: UpdateUnsupportedReason }
  | { status: 'failed'; currentVersion: string; error: string };

export type UpdateUnsupportedReason =
  /** Running from source; there is no installed artifact to replace. */
  | 'development'
  /** Installed from a .deb/.rpm — the package manager owns the files, not us. */
  | 'system-package'
  /** macOS needs a signed, notarised bundle, and nothing here builds one yet. */
  | 'unsigned-platform';
