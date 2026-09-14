import { describe, expect, it } from 'vitest';
import {
  MERGE_GAP_MS,
  MIN_SEGMENT_MS,
  RETENTION_DAYS,
  TOP_HOSTS,
  appendSegment,
  bucketSeconds,
  buildActivityView,
  coveredSeconds,
  hostOf,
  hostPattern,
  isRecordable,
  peakHourOf,
  pruneDays,
  segmentSeconds,
  sessionSegment,
  splitByDay,
  toHostTotals,
  toHourly,
  toMinuteSlots,
  totalSeconds,
} from '../../../src/shared/activity';
import { dateKey, shiftDays } from '../../../src/shared/time';
import type { ActivityDay, ActivitySegment, Rule } from '../../../src/shared/types';

const DAY = new Date(2026, 8, 14, 0, 0, 0).getTime();
const at = (hour: number, minute = 0, second = 0): number =>
  new Date(2026, 8, 14, hour, minute, second).getTime();

const seg = (over: Partial<ActivitySegment> = {}): ActivitySegment => ({
  url: 'https://x.com/home',
  host: 'x.com',
  startedAt: at(9),
  endedAt: at(9, 10),
  ...over,
});

const rule = (over: Partial<Rule> = {}): Rule => ({
  id: 'r1',
  pattern: 'x\\.com',
  limitMinutes: 5,
  createdAt: DAY,
  ...over,
});

describe('hostOf', () => {
  it('strips the www prefix', () => {
    expect(hostOf('https://www.youtube.com/watch?v=1')).toBe('youtube.com');
  });

  it('keeps other subdomains', () => {
    expect(hostOf('https://news.ycombinator.com/')).toBe('news.ycombinator.com');
  });

  it('returns an empty host for an unparseable URL', () => {
    expect(hostOf('not a url')).toBe('');
  });
});

describe('hostPattern', () => {
  it('escapes regex metacharacters so the host matches literally', () => {
    expect(hostPattern('x.com')).toBe('x\\.com');
    expect(hostPattern('a+b(c).test')).toBe('a\\+b\\(c\\)\\.test');
  });
});

describe('segment helpers', () => {
  it('measures a segment in seconds', () => {
    expect(segmentSeconds(seg({ startedAt: at(9), endedAt: at(9, 0, 30) }))).toBe(30);
  });

  it('never reports negative seconds for an inverted segment', () => {
    expect(segmentSeconds(seg({ startedAt: at(9), endedAt: at(8) }))).toBe(0);
  });

  it('builds a segment from a session', () => {
    const segment = sessionSegment(
      { tabId: 1, url: 'https://www.x.com/a', ruleIds: [], startedAt: at(9) },
      at(9, 5),
    );
    expect(segment).toEqual({
      url: 'https://www.x.com/a',
      host: 'x.com',
      startedAt: at(9),
      endedAt: at(9, 5),
    });
  });

  it('treats only segments at or over the minimum as recordable', () => {
    expect(isRecordable(seg({ startedAt: 0, endedAt: MIN_SEGMENT_MS }))).toBe(true);
    expect(isRecordable(seg({ startedAt: 0, endedAt: MIN_SEGMENT_MS - 1 }))).toBe(false);
  });
});

describe('splitByDay', () => {
  it('leaves a same-day segment alone', () => {
    const segment = seg();
    expect(splitByDay(segment)).toEqual([segment]);
  });

  it('splits a segment that crosses midnight at the boundary', () => {
    const parts = splitByDay(seg({ startedAt: at(23, 50), endedAt: at(24, 10) }));
    expect(parts).toHaveLength(2);
    expect(dateKey(parts[0]!.startedAt)).toBe('2026-09-14');
    expect(dateKey(parts[1]!.startedAt)).toBe('2026-09-15');
    expect(parts[0]!.endedAt).toBe(parts[1]!.startedAt);
  });

  it('produces nothing for a zero-length segment', () => {
    expect(splitByDay(seg({ startedAt: at(9), endedAt: at(9) }))).toEqual([]);
  });
});

describe('appendSegment', () => {
  it('creates the day when it does not exist yet', () => {
    const days = appendSegment([], seg());
    expect(days).toHaveLength(1);
    expect(days[0]!.date).toBe('2026-09-14');
    expect(days[0]!.segments).toHaveLength(1);
  });

  it('keeps days sorted by date when inserting an earlier one', () => {
    const later = appendSegment([], seg());
    const both = appendSegment(later, seg({ startedAt: at(9) - 86_400_000, endedAt: at(9, 5) - 86_400_000 }));
    expect(both.map((day) => day.date)).toEqual(['2026-09-13', '2026-09-14']);
  });

  it('merges an adjacent view of the same URL into the previous segment', () => {
    const first = appendSegment([], seg({ startedAt: at(9), endedAt: at(9, 5) }));
    const merged = appendSegment(first, seg({ startedAt: at(9, 5), endedAt: at(9, 9) }));
    expect(merged[0]!.segments).toHaveLength(1);
    expect(merged[0]!.segments[0]!.endedAt).toBe(at(9, 9));
  });

  it('keeps the later end when a merged segment is already longer', () => {
    const first = appendSegment([], seg({ startedAt: at(9), endedAt: at(9, 20) }));
    const merged = appendSegment(first, seg({ startedAt: at(9, 20), endedAt: at(9, 10) }));
    expect(merged[0]!.segments[0]!.endedAt).toBe(at(9, 20));
  });

  it('starts a new segment when the gap is too large', () => {
    const first = appendSegment([], seg({ startedAt: at(9), endedAt: at(9, 5) }));
    const apart = appendSegment(
      first,
      seg({ startedAt: at(9, 5) + MERGE_GAP_MS + 1, endedAt: at(9, 9) }),
    );
    expect(apart[0]!.segments).toHaveLength(2);
  });

  it('starts a new segment for a different URL', () => {
    const first = appendSegment([], seg({ startedAt: at(9), endedAt: at(9, 5) }));
    const other = appendSegment(
      first,
      seg({ url: 'https://y.com/', host: 'y.com', startedAt: at(9, 5), endedAt: at(9, 9) }),
    );
    expect(other[0]!.segments).toHaveLength(2);
  });
});

describe('pruneDays', () => {
  it('drops days older than the retention window and keeps the edge', () => {
    const oldest = dateKey(shiftDays(DAY, -(RETENTION_DAYS - 1)));
    const tooOld = dateKey(shiftDays(DAY, -RETENTION_DAYS));
    const days: ActivityDay[] = [
      { date: tooOld, segments: [] },
      { date: oldest, segments: [] },
      { date: '2026-09-14', segments: [] },
    ];
    expect(pruneDays(days, DAY).map((day) => day.date)).toEqual([oldest, '2026-09-14']);
  });
});

describe('toMinuteSlots', () => {
  it('spreads a segment across the minutes it covers', () => {
    const slots = toMinuteSlots([seg({ startedAt: at(9), endedAt: at(9, 3) })], '2026-09-14');
    expect(slots.map((slot) => slot.minute)).toEqual([540, 541, 542]);
    expect(slots.every((slot) => slot.activeSeconds === 60)).toBe(true);
    expect(slots[0]!.host).toBe('x.com');
  });

  it('reports a partial minute', () => {
    const slots = toMinuteSlots([seg({ startedAt: at(9), endedAt: at(9, 0, 20) })], '2026-09-14');
    expect(slots).toEqual([{ minute: 540, activeSeconds: 20, host: 'x.com' }]);
  });

  it('picks the host that dominated a shared minute', () => {
    const slots = toMinuteSlots(
      [
        seg({ startedAt: at(9), endedAt: at(9, 0, 15) }),
        seg({ url: 'https://y.com/', host: 'y.com', startedAt: at(9, 0, 15), endedAt: at(9, 1) }),
      ],
      '2026-09-14',
    );
    expect(slots).toEqual([{ minute: 540, activeSeconds: 60, host: 'y.com' }]);
  });

  it('keeps the dominant host when a shorter visit follows it in the same minute', () => {
    const slots = toMinuteSlots(
      [
        seg({ startedAt: at(9), endedAt: at(9, 0, 45) }),
        seg({ url: 'https://y.com/', host: 'y.com', startedAt: at(9, 0, 45), endedAt: at(9, 1) }),
      ],
      '2026-09-14',
    );
    expect(slots).toEqual([{ minute: 540, activeSeconds: 60, host: 'x.com' }]);
  });

  it('clamps segments that start before or end after the day', () => {
    const slots = toMinuteSlots(
      [seg({ startedAt: at(-1), endedAt: at(0, 2) }), seg({ startedAt: at(23, 59), endedAt: at(25) })],
      '2026-09-14',
    );
    expect(slots.map((slot) => slot.minute)).toEqual([0, 1, 1439]);
  });

  it('returns nothing for a day with no segments', () => {
    expect(toMinuteSlots([], '2026-09-14')).toEqual([]);
  });
});

describe('toHostTotals', () => {
  it('accumulates seconds and visits per host, largest first', () => {
    const totals = toHostTotals(
      [
        seg({ startedAt: at(9), endedAt: at(9, 1) }),
        seg({ startedAt: at(10), endedAt: at(10, 2) }),
        seg({ url: 'https://y.com/', host: 'y.com', startedAt: at(11), endedAt: at(11, 10) }),
      ],
      [],
      '2026-09-14',
    );
    expect(totals.map((entry) => [entry.host, entry.seconds, entry.visits])).toEqual([
      ['y.com', 600, 1],
      ['x.com', 180, 2],
    ]);
  });

  it('reports each host share of the day and its hourly profile', () => {
    const totals = toHostTotals(
      [
        seg({ startedAt: at(9), endedAt: at(9, 15) }),
        seg({ url: 'https://y.com/', host: 'y.com', startedAt: at(11), endedAt: at(11, 5) }),
      ],
      [],
      '2026-09-14',
    );
    expect(totals[0]!.share).toBeCloseTo(0.75, 5);
    expect(totals[1]!.share).toBeCloseTo(0.25, 5);
    expect(totals[0]!.hourly).toHaveLength(24);
    expect(totals[0]!.hourly[9]).toBe(900);
    expect(totals[1]!.hourly[11]).toBe(300);
  });

  it('labels a host by the URL it spent the most time on, not the latest', () => {
    const totals = toHostTotals(
      [
        seg({ url: 'https://x.com/long', startedAt: at(9), endedAt: at(9, 30) }),
        seg({ url: 'https://x.com/short', startedAt: at(10), endedAt: at(10, 1) }),
      ],
      [],
      '2026-09-14',
    );
    expect(totals[0]!.url).toBe('https://x.com/long');
  });

  it('reports a zero share when the day has no measurable time', () => {
    const totals = toHostTotals([seg({ startedAt: at(9), endedAt: at(9) })], [], '2026-09-14');
    expect(totals[0]!.share).toBe(0);
  });

  it('breaks ties on host name so the order is stable', () => {
    const totals = toHostTotals(
      [
        seg({ url: 'https://b.com/', host: 'b.com', startedAt: at(9), endedAt: at(9, 1) }),
        seg({ url: 'https://a.com/', host: 'a.com', startedAt: at(10), endedAt: at(10, 1) }),
      ],
      [],
      '2026-09-14',
    );
    expect(totals.map((entry) => entry.host)).toEqual(['a.com', 'b.com']);
  });

  it('reports the URL the host spent the most time on', () => {
    const totals = toHostTotals(
      [
        seg({ url: 'https://x.com/a', startedAt: at(9), endedAt: at(9, 1) }),
        seg({ url: 'https://x.com/b', startedAt: at(10), endedAt: at(10, 5) }),
      ],
      [],
      '2026-09-14',
    );
    expect(totals[0]!.url).toBe('https://x.com/b');
  });

  it('suggests an escaped pattern and flags hosts an existing rule covers', () => {
    const totals = toHostTotals(
      [seg(), seg({ url: 'https://y.com/', host: 'y.com' })],
      [rule()],
      '2026-09-14',
    );
    const covered = totals.find((entry) => entry.host === 'x.com');
    const uncovered = totals.find((entry) => entry.host === 'y.com');
    expect(covered?.suggestedPattern).toBe('x\\.com');
    expect(covered?.hasRule).toBe(true);
    expect(uncovered?.hasRule).toBe(false);
  });

  it('caps the list at the requested size', () => {
    const many = Array.from({ length: TOP_HOSTS + 4 }, (_unused, index) =>
      seg({ url: `https://s${index}.com/`, host: `s${index}.com` }),
    );
    expect(toHostTotals(many, [], '2026-09-14')).toHaveLength(TOP_HOSTS);
    expect(toHostTotals(many, [], '2026-09-14', 3)).toHaveLength(3);
  });
});

describe('totalSeconds', () => {
  it('adds every segment', () => {
    expect(totalSeconds([seg({ startedAt: at(9), endedAt: at(9, 1) }), seg()])).toBe(660);
  });
});

describe('coveredSeconds', () => {
  it('counts only time on hosts a rule already covers', () => {
    const segments = [
      seg({ startedAt: at(9), endedAt: at(9, 2) }),
      seg({ url: 'https://y.com/', host: 'y.com', startedAt: at(10), endedAt: at(10, 5) }),
    ];
    expect(coveredSeconds(segments, [rule()])).toBe(120);
    expect(coveredSeconds(segments, [])).toBe(0);
  });
});

describe('peakHourOf', () => {
  const hours = (entries: Record<number, number>): number[] =>
    Array.from({ length: 24 }, (_unused, hour) => entries[hour] ?? 0);

  it('picks the hour holding the most time, and says how much', () => {
    expect(peakHourOf(hours({ 9: 600, 14: 1800, 21: 300 }))).toEqual({ hour: 14, seconds: 1800 });
  });

  it('keeps the earlier hour when two are level', () => {
    expect(peakHourOf(hours({ 8: 1800, 17: 1800 }))).toEqual({ hour: 8, seconds: 1800 });
  });

  it('has no answer for a day with nothing in it', () => {
    expect(peakHourOf(hours({}))).toBeNull();
  });

  it('counts midnight like any other hour', () => {
    expect(peakHourOf(hours({ 0: 1200, 6: 60 }))).toEqual({ hour: 0, seconds: 1200 });
  });
});

describe('bucketSeconds and toHourly', () => {
  it('places a segment in the hour it falls in', () => {
    const hourly = toHourly([seg({ startedAt: at(9, 10), endedAt: at(9, 40) })], '2026-09-14');
    expect(hourly).toHaveLength(24);
    expect(hourly[9]).toBe(1800);
    expect(hourly.reduce((sum, value) => sum + value, 0)).toBe(1800);
  });

  it('splits a segment that spans an hour boundary', () => {
    const hourly = toHourly([seg({ startedAt: at(9, 50), endedAt: at(10, 20) })], '2026-09-14');
    expect(hourly[9]).toBe(600);
    expect(hourly[10]).toBe(1200);
  });

  it('clamps segments outside the day', () => {
    const hourly = toHourly([seg({ startedAt: at(-2), endedAt: at(0, 30) })], '2026-09-14');
    expect(hourly[0]).toBe(1800);
  });

  it('supports arbitrary bucket sizes', () => {
    const buckets = bucketSeconds([seg({ startedAt: at(0), endedAt: at(0, 90) })], '2026-09-14', 48, 1_800_000);
    expect(buckets[0]).toBe(1800);
    expect(buckets[1]).toBe(1800);
    expect(buckets[2]).toBe(1800);
    expect(buckets[3]).toBe(0);
  });
});

describe('buildActivityView', () => {
  const days: ActivityDay[] = [
    { date: '2026-09-13', segments: [seg({ startedAt: at(9) - 86_400_000, endedAt: at(9, 1) - 86_400_000 })] },
    {
      date: '2026-09-14',
      segments: [
        seg({ startedAt: at(9), endedAt: at(9, 2) }),
        seg({ url: 'https://y.com/', host: 'y.com', startedAt: at(11), endedAt: at(11, 30) }),
      ],
    },
    { date: '2026-09-15', segments: [] },
  ];

  it('summarises the requested day', () => {
    const view = buildActivityView(days, [], '2026-09-14', DAY);
    expect(view.date).toBe('2026-09-14');
    expect(view.totalSeconds).toBe(1920);
    expect(view.hostCount).toBe(2);
    expect(view.top).toHaveLength(2);
    expect(view.minutes.length).toBeGreaterThan(0);
  });

  it('reports the busiest hour', () => {
    const view = buildActivityView(days, [], '2026-09-14', DAY);
    // This day has two minutes at 09:00 and half an hour at 11:00. The old busiest-minute
    // reading named 09:00, because that is where the first full minute landed.
    expect(view.peak).toEqual({ hour: 11, seconds: 1800 });
  });

  it('has no peak on a day with no activity', () => {
    const view = buildActivityView(days, [], '2026-09-12', DAY);
    expect(view.peak).toBeNull();
    expect(view.totalSeconds).toBe(0);
    expect(view.top).toEqual([]);
  });

  it('exposes the retention window and the days that hold data', () => {
    const view = buildActivityView(days, [], '2026-09-14', DAY);
    expect(view.maxDate).toBe('2026-09-14');
    expect(view.minDate).toBe(dateKey(shiftDays(DAY, -(RETENTION_DAYS - 1))));
    expect(view.datesWithData).toEqual(['2026-09-13', '2026-09-14']);
  });

  it('includes the hourly profile and the share already under a limit', () => {
    const view = buildActivityView(days, [rule()], '2026-09-14', DAY);
    expect(view.hourly).toHaveLength(24);
    expect(view.hourly[9]).toBe(120);
    expect(view.hourly[11]).toBe(1800);
    expect(view.coveredSeconds).toBe(120);
  });
});
