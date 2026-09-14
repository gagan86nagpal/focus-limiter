import { ruleMatches } from './rules';
import { dateKey, dateStart, shiftDays } from './time';
import type {
  ActivityDay,
  ActivitySegment,
  ActivityView,
  HostTotal,
  MinuteSlot,
  PeakHour,
  Rule,
  Session,
} from './types';

/** How many days of history the activity tab keeps, including today. */
export const RETENTION_DAYS = 30;
/** How many hosts the "where the day went" list shows. */
export const TOP_HOSTS = 10;
export const MINUTES_PER_DAY = 1440;
export const HOURS_PER_DAY = 24;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/**
 * Views shorter than this are dropped, and two views of the same URL closer than this are
 * merged. Reconcile runs on every tab and focus event, so without merging a single sitting
 * would be stored as dozens of adjacent slivers.
 */
export const MIN_SEGMENT_MS = 1000;
export const MERGE_GAP_MS = 2000;

/** Hostname without the `www.` prefix, or `''` for a URL that cannot be parsed. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** A regex matching this host literally, safe to drop straight into the rule form. */
export function hostPattern(host: string): string {
  return host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function segmentSeconds(segment: ActivitySegment): number {
  return Math.max(0, segment.endedAt - segment.startedAt) / 1000;
}

/** The segment a session would produce if it ended now. */
export function sessionSegment(session: Session, endedAt: number): ActivitySegment {
  return { url: session.url, host: hostOf(session.url), startedAt: session.startedAt, endedAt };
}

/** Long enough to be worth storing or charting. */
export function isRecordable(segment: ActivitySegment): boolean {
  return segment.endedAt - segment.startedAt >= MIN_SEGMENT_MS;
}

/** Splits a segment that crosses local midnight so each part belongs to exactly one day. */
export function splitByDay(segment: ActivitySegment): ActivitySegment[] {
  const parts: ActivitySegment[] = [];
  let from = segment.startedAt;
  while (from < segment.endedAt) {
    const to = Math.min(segment.endedAt, shiftDays(from, 1));
    parts.push({ ...segment, startedAt: from, endedAt: to });
    from = to;
  }
  return parts;
}

function byDate(a: ActivityDay, b: ActivityDay): number {
  return a.date < b.date ? -1 : 1;
}

function addPart(days: ActivityDay[], part: ActivitySegment): ActivityDay[] {
  const date = dateKey(part.startedAt);
  const index = days.findIndex((day) => day.date === date);
  if (index === -1) {
    return [...days, { date, segments: [part] }].sort(byDate);
  }

  const day = days[index] as ActivityDay;
  const last = day.segments[day.segments.length - 1];
  const continues = last !== undefined && last.url === part.url && part.startedAt - last.endedAt <= MERGE_GAP_MS;
  const segments = continues
    ? [...day.segments.slice(0, -1), { ...last, endedAt: Math.max(last.endedAt, part.endedAt) }]
    : [...day.segments, part];

  const next = days.slice();
  next[index] = { date, segments };
  return next;
}

/** Adds a segment to the log, merging it into the previous view of the same URL when adjacent. */
export function appendSegment(days: ActivityDay[], segment: ActivitySegment): ActivityDay[] {
  return splitByDay(segment).reduce(addPart, days);
}

/** Drops days outside the retention window. */
export function pruneDays(days: ActivityDay[], now: number): ActivityDay[] {
  const cutoff = dateKey(shiftDays(now, -(RETENTION_DAYS - 1)));
  return days.filter((day) => day.date >= cutoff).sort(byDate);
}

/**
 * Spreads segments across the day's 1440 minutes.
 *
 * Only minutes with activity are returned; a quiet day stays a short list rather than 1440
 * mostly-empty entries crossing the message boundary on every refresh.
 */
export function toMinuteSlots(segments: ActivitySegment[], date: string): MinuteSlot[] {
  const start = dateStart(date);
  const end = start + MINUTES_PER_DAY * MINUTE_MS;
  const byMinute = new Map<number, Map<string, number>>();

  for (const segment of segments) {
    let cursor = Math.max(segment.startedAt, start);
    const stop = Math.min(segment.endedAt, end);
    while (cursor < stop) {
      const minute = Math.floor((cursor - start) / MINUTE_MS);
      const minuteEnd = start + (minute + 1) * MINUTE_MS;
      const until = Math.min(stop, minuteEnd);
      const hosts = byMinute.get(minute) ?? new Map<string, number>();
      hosts.set(segment.host, (hosts.get(segment.host) ?? 0) + (until - cursor) / 1000);
      byMinute.set(minute, hosts);
      cursor = until;
    }
  }

  return [...byMinute.entries()]
    .map(([minute, hosts]) => {
      let host = '';
      let best = 0;
      let total = 0;
      for (const [candidate, seconds] of hosts) {
        total += seconds;
        if (seconds > best) {
          best = seconds;
          host = candidate;
        }
      }
      return { minute, activeSeconds: Math.min(60, Math.round(total)), host };
    })
    .sort((a, b) => a.minute - b.minute);
}

/** Spreads segment time into fixed-width buckets covering the day. */
export function bucketSeconds(
  segments: ActivitySegment[],
  date: string,
  buckets: number,
  bucketMs: number,
): number[] {
  const start = dateStart(date);
  const end = start + buckets * bucketMs;
  const out = new Array<number>(buckets).fill(0);
  for (const segment of segments) {
    let cursor = Math.max(segment.startedAt, start);
    const stop = Math.min(segment.endedAt, end);
    while (cursor < stop) {
      const index = Math.floor((cursor - start) / bucketMs);
      const until = Math.min(stop, start + (index + 1) * bucketMs);
      out[index] = (out[index] as number) + (until - cursor) / 1000;
      cursor = until;
    }
  }
  return out.map((seconds) => Math.round(seconds));
}

/** Seconds of activity in each of the day's 24 hours. */
export function toHourly(segments: ActivitySegment[], date: string): number[] {
  return bucketSeconds(segments, date, HOURS_PER_DAY, HOUR_MS);
}

function dominantKey(counts: Map<string, number>): string {
  let best = '';
  let bestValue = -1;
  for (const [key, value] of counts) {
    if (value > bestValue) {
      best = key;
      bestValue = value;
    }
  }
  return best;
}

/** Accumulates time per host, biggest first, capped at `limit`. */
export function toHostTotals(
  segments: ActivitySegment[],
  rules: Rule[],
  date: string,
  limit = TOP_HOSTS,
): HostTotal[] {
  interface Tally {
    seconds: number;
    visits: number;
    urls: Map<string, number>;
    segments: ActivitySegment[];
  }
  const totals = new Map<string, Tally>();

  for (const segment of segments) {
    const entry: Tally = totals.get(segment.host) ?? {
      seconds: 0,
      visits: 0,
      urls: new Map<string, number>(),
      segments: [],
    };
    const seconds = segmentSeconds(segment);
    entry.seconds += seconds;
    entry.visits += 1;
    entry.urls.set(segment.url, (entry.urls.get(segment.url) ?? 0) + seconds);
    entry.segments.push(segment);
    totals.set(segment.host, entry);
  }

  const overall = totalSeconds(segments);
  return [...totals.entries()]
    .map(([host, entry]) => {
      const url = dominantKey(entry.urls);
      const seconds = Math.round(entry.seconds);
      return {
        host,
        url,
        seconds,
        visits: entry.visits,
        share: overall === 0 ? 0 : seconds / overall,
        hourly: toHourly(entry.segments, date),
        suggestedPattern: hostPattern(host),
        hasRule: rules.some((rule) => ruleMatches(rule, url)),
      };
    })
    .sort((a, b) => b.seconds - a.seconds || (a.host < b.host ? -1 : 1))
    .slice(0, limit);
}

export function totalSeconds(segments: ActivitySegment[]): number {
  return Math.round(segments.reduce((sum, segment) => sum + segmentSeconds(segment), 0));
}

/** Time spent on hosts an existing rule already covers. */
export function coveredSeconds(segments: ActivitySegment[], rules: Rule[]): number {
  return totalSeconds(segments.filter((segment) => rules.some((rule) => ruleMatches(rule, segment.url))));
}

/**
 * The hour of the day with the most time on screen, or null on a day with nothing in it.
 *
 * This used to pick the busiest *minute*, which sounded sharper but said very little: a minute
 * holds at most sixty seconds, so any unbroken sitting produces a long run of minutes tied at
 * the top and the reading collapsed to whenever you first sat still for a whole minute. Hours
 * are wide enough to actually differ from one another.
 */
export function peakHourOf(hourly: number[]): PeakHour | null {
  let peak: PeakHour | null = null;
  for (const [hour, seconds] of hourly.entries()) {
    // Strictly greater, so a tie keeps the earlier hour rather than drifting later.
    if (seconds > (peak?.seconds ?? 0)) peak = { hour, seconds };
  }
  return peak;
}

/** Assembles everything the activity tab needs for one day. */
export function buildActivityView(
  days: ActivityDay[],
  rules: Rule[],
  date: string,
  now: number,
): ActivityView {
  const segments = days.find((day) => day.date === date)?.segments ?? [];
  const minutes = toMinuteSlots(segments, date);
  const hourly = toHourly(segments, date);
  return {
    date,
    minDate: dateKey(shiftDays(now, -(RETENTION_DAYS - 1))),
    maxDate: dateKey(now),
    totalSeconds: totalSeconds(segments),
    coveredSeconds: coveredSeconds(segments, rules),
    hostCount: new Set(segments.map((segment) => segment.host)).size,
    peak: peakHourOf(hourly),
    hourly,
    minutes,
    top: toHostTotals(segments, rules, date),
    datesWithData: days.filter((day) => day.segments.length > 0).map((day) => day.date),
  };
}
