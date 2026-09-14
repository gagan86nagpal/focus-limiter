const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Local calendar date key, e.g. "2026-09-14". Usage resets when this changes. */
export function dateKey(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Timestamp of local midnight at the start of the day containing `timestamp`. */
export function startOfDay(timestamp: number): number {
  const d = new Date(timestamp);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Local midnight `days` away from the day containing `timestamp`.
 *
 * Goes through `Date` rather than adding 86_400_000 so days that are not 24 hours long,
 * such as daylight-saving changeovers, still land on midnight.
 */
export function shiftDays(timestamp: number, days: number): number {
  const d = new Date(timestamp);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** Local midnight that starts the given "YYYY-MM-DD" key. Inverse of `dateKey`. */
export function dateStart(date: string): number {
  const [year, month, day] = date.split('-');
  return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
}

/** Minute of the day as a 24-hour clock reading: 0 -> "00:00", 845 -> "14:05". */
export function formatClock(minuteOfDay: number): string {
  const m = Math.max(0, Math.min(1439, Math.floor(minuteOfDay)));
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** Friendly day label for the activity tab: "Today", "Yesterday", or "Mon 14 Sep". */
export function formatDayLabel(date: string, now: number): string {
  if (date === dateKey(now)) return 'Today';
  if (date === dateKey(shiftDays(now, -1))) return 'Yesterday';
  return new Date(dateStart(date)).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** Formats elapsed seconds for display: "31s", "2m 31s", "1h 05m 00s". */
export function formatUsage(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  if (hours > 0) return `${hours}h ${pad2(minutes)}m ${pad2(seconds)}s`;
  if (minutes > 0) return `${minutes}m ${pad2(seconds)}s`;
  return `${seconds}s`;
}

/**
 * Elapsed seconds at headline size: "38s", "41m", "4h 06m".
 *
 * Drops the seconds that `formatUsage` keeps, because a figure set in 30px type wraps to two
 * lines long before anyone cares whether a four-hour day was four hours and six or seven minutes.
 */
export function formatCompact(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (hours > 0) return `${hours}h ${pad2(minutes)}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${s}s`;
}

/** Formats a limit in minutes for display: "5m", "1h", "1h 30m". */
export function formatLimit(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

/** Human-friendly relative time for metadata such as "Last updated 2 minutes ago". */
export function formatRelative(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}
