import os from 'node:os';

/**
 * The machine's physical memory, in megabytes.
 *
 * `os.totalmem()` is the one measurement available on every platform this ships
 * to without shelling out to `wmic`, `sysctl` or `/proc/meminfo` — all three of
 * which would then be three things to keep working. It reports what the OS can
 * hand out, which is a little under what is on the sticks: firmware and the
 * integrated GPU take their share first, so a "16 GB" machine answers with
 * something closer to 15.8. That is the honest number for this purpose, because
 * it is the memory a heap could actually be backed by.
 *
 * Read at each call rather than cached: memory is hot-pluggable in a VM, and
 * the launcher can outlive a resize.
 */
export function machineMemoryMb(): number {
  return Math.round(os.totalmem() / 1024 / 1024);
}
