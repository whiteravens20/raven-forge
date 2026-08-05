/**
 * Cancellation for the long-running per-profile jobs: the launch prepare phase
 * and manifest sync.
 *
 * Both can run for minutes — a JRE, thousands of assets, a modpack's worth of
 * jars — and before this the only way out was to kill the launcher, which left
 * half-written files behind. A job registers a controller under its profile id;
 * the UI aborts it by id over IPC.
 *
 * One job per profile at a time, which is already enforced upstream: the launch
 * button locks out while preparing and `launchGame` refuses a second run.
 */
import { log } from '../../main/logger';

const controllers = new Map<string, AbortController>();

/** Thrown when a job is aborted, so callers can tell it apart from a failure. */
export class CancelledError extends Error {
  constructor(what: string) {
    super(`${what} cancelled`);
    this.name = 'CancelledError';
  }
}

export function isCancellation(err: unknown): boolean {
  return (
    err instanceof CancelledError ||
    (err instanceof Error && (err.name === 'AbortError' || err.name === 'CancelledError'))
  );
}

/**
 * Start tracking a job. Any signal already registered for this profile is
 * aborted first — a stale controller would otherwise make the new job
 * uncancellable.
 */
export function beginJob(profileId: string): AbortSignal {
  controllers.get(profileId)?.abort(new CancelledError('Previous job'));
  const controller = new AbortController();
  controllers.set(profileId, controller);
  return controller.signal;
}

export function endJob(profileId: string): void {
  controllers.delete(profileId);
}

/** Returns false when there was nothing running for that profile. */
export function cancelJob(profileId: string): boolean {
  const controller = controllers.get(profileId);
  if (!controller) return false;
  log.info(`Cancelling job for profile ${profileId}`);
  controller.abort(new CancelledError('Job'));
  controllers.delete(profileId);
  return true;
}

/**
 * Combine a job's signal with a per-request timeout. `AbortSignal.any` settles
 * on whichever fires first, so a cancelled job drops its in-flight request
 * immediately instead of waiting out the timeout.
 */
export function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** Throw if the job was cancelled — for checking between steps. */
export function throwIfCancelled(signal: AbortSignal | undefined, what: string): void {
  if (signal?.aborted) throw new CancelledError(what);
}
