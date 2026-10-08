// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import type { ErrorMessage } from '../../shared/ipc-types';

/**
 * Something the launcher will not do, for a reason the player can act on.
 *
 * Two kinds of thing go wrong, and only one of them is a fault: a download that
 * times out is a fault, while "this file is not a resource pack" is an
 * instruction. The second kind is read by somebody who is about to go and
 * change something, so it has to arrive in their own language — and `src/core/`
 * has no locale, which is why the key travels rather than the sentence. See
 * `ErrorKey` in `shared/ipc/common.ts`.
 *
 * The English message is written alongside it and kept: that is what the log
 * records and what a bug report quotes, and one place stating both means they
 * cannot drift apart.
 */
export class RefusedError extends Error {
  constructor(
    readonly errorMessage: ErrorMessage,
    message: string,
  ) {
    super(message);
    this.name = 'RefusedError';
  }
}

/** The sayable form of a refusal, or undefined for anything else that threw. */
export function refusalOf(err: unknown): ErrorMessage | undefined {
  return err instanceof RefusedError ? err.errorMessage : undefined;
}
