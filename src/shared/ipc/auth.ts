// Accounts and how the launcher holds their credentials.
// Part of the IPC contract — see `../ipc-types.ts`.

export interface MinecraftAccount {
  id: string;
  uuid: string;
  username: string;
  type: 'microsoft' | 'offline';
  skinUrl?: string;
  /** ISO 8601 timestamp of last successful auth */
  lastAuthenticated?: string;
}

export interface AuthState {
  accounts: MinecraftAccount[];
  activeAccountId: string | null;
  isAuthenticating: boolean;
  /**
   * The OS keychain was unusable, so credentials are in a 0600 file instead.
   * Shown on the Accounts page — it is a real reduction in protection and the
   * person it applies to is the one entitled to know about it.
   */
  credentialsInPlaintext?: boolean;
  /** Where that file is, so the warning can name it. */
  credentialsFile?: string;
}
