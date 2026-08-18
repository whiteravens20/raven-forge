import { DEFAULT_RAM_MB, MAX_RAM_MB, MIN_RAM_MB, RAM_STEP_MB } from './constants';

/**
 * How much of the machine a profile may hand to the game.
 *
 * Pure arithmetic over one number — the machine's physical memory — so the
 * profile form, the pack installer and the launch check all reach the same
 * verdict. Split out rather than left in the renderer because two of those
 * three run in the main process, and a slider that says a value is fine while
 * the launcher refuses it is worse than either answer on its own.
 *
 * Nothing here reads the machine; `machineMemoryMb()` in `core/util` does that.
 * A total of `undefined` means the machine could not be measured, and every
 * function below then falls back to having no opinion — a launcher that stops
 * working because it could not read `os.totalmem()` would be a worse bug than
 * the one this fixes.
 */

/**
 * The most this machine can spare for the game.
 *
 * Two rules, whichever bites first: the game never gets more than three
 * quarters of the machine, and the last 2 GB are never the game's. Below about
 * 8 GB of total memory the second binds and above it the first — which is the
 * right way round. A small machine's problem is absolute: the OS needs a
 * roughly fixed amount of room whatever else is happening. A large machine's is
 * proportional, because `-Xmx` bounds the *heap* and a running JVM spends
 * another gigabyte or so outside it on class metadata, thread stacks, the code
 * cache and whatever the graphics driver maps.
 *
 * This is where the warning starts, not what to choose — that is
 * `recommendedRamMb`, which is a good deal lower.
 */
export function safeMaxRamMb(totalMb: number | undefined): number {
  if (!isMeasured(totalMb)) return MAX_RAM_MB;
  return toStep(Math.min(totalMb * 0.75, totalMb - 2048));
}

/**
 * What a new profile on this machine should start at.
 *
 * Modded Minecraft is comfortable at 4 GB and only genuinely wants more under a
 * pack of several hundred mods. The 8 GB ceiling is deliberate and applies to a
 * 64 GB workstation as much as to a laptop: past it the heap stops being the
 * bottleneck and the collector's pauses start being one, so a bigger number
 * buys stutter rather than speed. Anyone who knows better can still type it.
 */
export function recommendedRamMb(totalMb: number | undefined): number {
  if (!isMeasured(totalMb)) return DEFAULT_RAM_MB;
  const wanted =
    totalMb < 6 * 1024 ? 2048 : totalMb < 12 * 1024 ? 4096 : totalMb < 24 * 1024 ? 6144 : 8192;
  return Math.min(wanted, safeMaxRamMb(totalMb));
}

/**
 * `ok` — fits. `tight` — more than the machine can spare, and the game will
 * swap, stutter, or be killed once it grows into it. `over` — more than the
 * machine physically has, which is not a configuration that runs: the JVM
 * refuses to reserve the heap on Windows, and on Linux the OOM killer collects
 * the game later instead.
 */
export type RamAdvice = 'ok' | 'tight' | 'over';

export function ramAdvice(requestedMb: number, totalMb: number | undefined): RamAdvice {
  if (!isMeasured(totalMb)) return 'ok';
  if (requestedMb > totalMb) return 'over';
  return requestedMb > safeMaxRamMb(totalMb) ? 'tight' : 'ok';
}

/**
 * Megabytes as the gigabytes a person thinks in.
 *
 * The same shape `formatBytes` uses in the renderer — one decimal below ten,
 * none above — so a size quoted by a launch error and the same size on the
 * slider read as the same number.
 */
export function formatRamGb(mb: number): string {
  const gb = mb / 1024;
  return `${gb.toFixed(gb < 10 ? 1 : 0)} GB`;
}

function isMeasured(totalMb: number | undefined): totalMb is number {
  return typeof totalMb === 'number' && Number.isFinite(totalMb) && totalMb > 0;
}

/** Down to a whole step, and inside the bounds the profile schema will accept. */
function toStep(mb: number): number {
  const stepped = Math.floor(mb / RAM_STEP_MB) * RAM_STEP_MB;
  return Math.min(Math.max(stepped, MIN_RAM_MB), MAX_RAM_MB);
}
