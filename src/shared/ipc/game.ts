// Starting the game, and what it says while it runs.
// Part of the IPC contract — see `../ipc-types.ts`.

export interface LaunchOptions {
  profileId: string;
  /** Override: connect to server on launch */
  quickConnect?: boolean;
  /**
   * Per-launch override of the global offline setting. Undefined means "use the
   * global setting"; `false` is a deliberate "go online this once" and is not
   * the same thing.
   */
  offlineMode?: boolean;
}

export interface GameLogLine {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface GameExitInfo {
  profileId: string;
  exitCode: number;
  crashed: boolean;
  /** Last N lines of game log if crashed */
  logTail?: string[];
  playTimeMinutes: number;
  /**
   * The crash report written for this exit, if one could be written.
   *
   * A file under `crash-reports/`, already stripped of credentials, holding
   * what a bug report needs — versions, mods, the game's own crash file. The
   * log tail above is the same output, but it lives only in this object: it is
   * gone when the card is dismissed and gone again when the app restarts.
   */
  reportPath?: string;
}
