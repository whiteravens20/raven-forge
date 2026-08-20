// Results, error codes and progress — the shapes every channel shares.
// Part of the IPC contract — see `../ipc-types.ts`.

export interface IpcResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  /**
   * A stable machine-readable tag for failures the UI must react to rather than
   * merely display. Matching on `error` text would break the moment anyone
   * rewords it, and it is translated.
   */
  code?: IpcErrorCode;
  /**
   * The same failure in a form the renderer can translate, for the failures
   * that have one. `error` is always set as well, in English, because that is
   * what gets logged and quoted — see {@link ErrorKey}.
   */
  errorMessage?: ErrorMessage;
}

/**
 * `AUTH_UNREACHABLE` — Microsoft's or Mojang's auth endpoints could not be
 * reached, as opposed to rejecting us. The distinction matters: unreachable is
 * recoverable by launching offline, rejected is not.
 */
export type IpcErrorCode = 'AUTH_UNREACHABLE';

/**
 * Failure messages the main process may name for the renderer to say.
 *
 * The same rule as {@link ProgressKey}, for the same reason: `src/core/` has no
 * locale. The list is deliberately short. It covers the failures the launcher
 * itself raises about something the player can go and change — those are read
 * as instructions, and an instruction in a language the reader did not choose
 * is not one. Everything else keeps its English `error` text: a wrapped network
 * or filesystem fault is a diagnostic, a key per cause would be a dictionary of
 * things nobody can act on, and the log wants the original words in any case.
 *
 * Every member must exist in the dictionaries — the renderer hands them to
 * `t()`, so one that is not a `TranslationKey` is a type error there.
 */
export type ErrorKey =
  | 'launchError.alreadyRunning'
  | 'launchError.alreadyPreparing'
  | 'launchError.ramTooBig'
  | 'launchError.javaNotRuntime'
  | 'launchError.javaTooOld';

/** A failure the renderer can say in the user's language. */
export interface ErrorMessage {
  key: ErrorKey;
  vars?: ProgressVars;
}

/**
 * Translation keys the main process is allowed to name in a progress event.
 *
 * Listed here rather than left as free text because these lines are written in
 * `src/core/`, which has no locale and no business having one — and they used
 * to be hardcoded Polish, so an English user watched their install narrate
 * itself in a language they had not chosen, past a fully working i18n layer.
 *
 * Every member must exist in the dictionaries: the renderer passes them
 * straight to `t()`, so a key that is not a `TranslationKey` is a type error
 * where it is resolved.
 */
export type ProgressKey =
  | 'progress.msg.downloading'
  | 'progress.msg.downloadingFile'
  | 'progress.msg.checkingFiles'
  | 'progress.msg.downloadComplete'
  | 'progress.msg.libraries'
  | 'progress.msg.assets'
  | 'progress.msg.javaDownloading'
  | 'progress.msg.javaReady'
  | 'progress.msg.syncing'
  | 'progress.msg.loaderProfile'
  | 'progress.msg.loaderInstalled'
  | 'progress.msg.installerDownloading'
  | 'progress.msg.preparingGameFiles'
  | 'progress.msg.preparingJava'
  | 'progress.msg.runningInstaller'
  | 'progress.msg.savingProfile'
  | 'progress.msg.updateDownloading'
  | 'progress.msg.movingData';

/** Counted keys, which need a plural variant chosen for them. */
export type ProgressPluralKey = 'progress.msg.synced';

export type ProgressVars = Record<string, string | number>;

/**
 * One line of status, in a form the renderer can say in the user's language.
 *
 * `text` is the exception and not a loophole: a mod's name and a config file's
 * path read the same in every language, and routing them through a dictionary
 * would mean inventing a key per mod.
 */
export type ProgressMessage =
  | { key: ProgressKey; vars?: ProgressVars }
  | { pluralKey: ProgressPluralKey; count: number; vars?: ProgressVars }
  | { text: string };

export interface ProgressEvent {
  /** Unique ID for the operation (e.g. profile ID or download batch ID) */
  operationId: string;
  /** 0.0 – 1.0 */
  progress: number;
  /** What is happening, as a key the renderer resolves — see {@link ProgressMessage}. */
  message: ProgressMessage;
  /** Current file being processed (if applicable) */
  currentFile?: string;
  /** Bytes downloaded so far */
  bytesDownloaded?: number;
  /** Total bytes expected */
  bytesTotal?: number;
  /** Files completed / total */
  filesCompleted?: number;
  filesTotal?: number;
}
