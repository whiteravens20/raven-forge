import type { ErrorMessage } from '../../shared/ipc-types';

/**
 * A launch the launcher refused because of how the profile is set up.
 *
 * Two things are wrong with a launch that fails, and only one of them is a
 * fault: a download that times out is a fault, while "this profile allocates
 * more RAM than the machine has" is an instruction. The second kind is read by
 * somebody who is about to go and change a setting, so it has to arrive in
 * their own language — and `src/core/` has no locale, which is why the key
 * travels rather than the sentence. See `ErrorKey` in `shared/ipc/common.ts`.
 *
 * The English message is written alongside it and kept: that is what the log
 * records and what a bug report quotes, and one place stating both means they
 * cannot drift apart.
 */
export class LaunchRefusedError extends Error {
  constructor(
    readonly errorMessage: ErrorMessage,
    message: string,
  ) {
    super(message);
    this.name = 'LaunchRefusedError';
  }
}

/** The sayable form of a refusal, or undefined for anything else that threw. */
export function launchRefusal(err: unknown): ErrorMessage | undefined {
  return err instanceof LaunchRefusedError ? err.errorMessage : undefined;
}
