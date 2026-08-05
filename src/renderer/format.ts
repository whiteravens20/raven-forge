/**
 * A byte count as a person would say it.
 *
 * Binary units, because that is what every file manager on every platform this
 * ships to reports, and a launcher disagreeing with the operating system about
 * the size of the same folder is a bug report waiting to happen. One decimal
 * below ten and none above it: "4.3 GB" is worth the digit, "847.2 MB" is not.
 */
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}
