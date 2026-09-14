import { describe, expect, it } from 'vitest';
import {
  DEMO_CLOCK_MINUTES,
  DEMO_DAYS,
  DEMO_HOSTS,
  DEMO_SEED,
  demoActivity,
  demoNow,
  demoRules,
  demoSeed,
  demoUsage,
  generateSegments,
  mulberry32,
  pickHost,
  type DemoHost,
} from '../../../src/demo/fixtures';
import { limitSeconds, ruleMatches } from '../../../src/shared/rules';
import { dateKey, startOfDay } from '../../../src/shared/time';
import type { ActivityDay } from '../../../src/shared/types';

const NOON = new Date('2026-09-14T12:00:00').getTime();
const MINUTE = 60_000;

/** A generator that walks a fixed list, so a test can steer host and duration choices. */
function scripted(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] as number;
}

describe('mulberry32', () => {
  it('produces the same stream for the same seed', () => {
    const a = mulberry32(DEMO_SEED);
    const b = mulberry32(DEMO_SEED);
    const first = [a(), a(), a()];
    expect(first).toEqual([b(), b(), b()]);
  });

  it('produces a different stream for a different seed', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('stays within the unit interval', () => {
    const rand = mulberry32(DEMO_SEED);
    for (let i = 0; i < 500; i += 1) {
      const value = rand();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('pickHost', () => {
  it('returns the first host when the draw lands at the bottom of the range', () => {
    expect(pickHost(() => 0)).toBe(DEMO_HOSTS[0]);
  });

  it('returns the last host when the draw lands at the very top', () => {
    // Nothing subtracts to zero or below until the final weight is applied.
    expect(pickHost(() => 0.999999)).toBe(DEMO_HOSTS[DEMO_HOSTS.length - 1]);
  });

  it('honours the weights it is given', () => {
    const hosts: DemoHost[] = [
      { host: 'a.com', path: '/', weight: 1, minMinutes: 1, maxMinutes: 1 },
      { host: 'b.com', path: '/', weight: 9, minMinutes: 1, maxMinutes: 1 },
    ];
    expect(pickHost(() => 0.05, hosts).host).toBe('a.com');
    expect(pickHost(() => 0.5, hosts).host).toBe('b.com');
  });

  it('refuses an empty list rather than returning something undefined', () => {
    expect(() => pickHost(() => 0.5, [])).toThrow('No demo hosts to choose from');
  });
});

describe('generateSegments', () => {
  it('lays out sittings in order without overlapping', () => {
    const segments = generateSegments(NOON, NOON + 6 * 60 * MINUTE, mulberry32(7));
    expect(segments.length).toBeGreaterThan(1);
    for (let i = 1; i < segments.length; i += 1) {
      const previous = segments[i - 1] as { endedAt: number };
      const current = segments[i] as { startedAt: number; endedAt: number };
      expect(current.startedAt).toBeGreaterThanOrEqual(previous.endedAt);
      expect(current.endedAt).toBeGreaterThan(current.startedAt);
    }
  });

  it('builds a url from the host and its path', () => {
    const [first] = generateSegments(NOON, NOON + 60 * MINUTE, mulberry32(3));
    expect(first?.url).toBe(`https://${String(first?.host)}${DEMO_HOSTS.find((h) => h.host === first?.host)?.path ?? ''}`);
  });

  it('never runs past the end of the window', () => {
    const until = NOON + 30 * MINUTE;
    for (const segment of generateSegments(NOON, until, mulberry32(11))) {
      expect(segment.endedAt).toBeLessThanOrEqual(until);
    }
  });

  it('drops a sitting clipped to under a minute instead of drawing a sliver', () => {
    // Always drawing zero picks the first host, runs it for its minimum, then waits the
    // shortest gap of two minutes. Closing the window half a minute after that leaves the
    // second sitting too short to keep.
    const first = (DEMO_HOSTS[0] as DemoHost).minMinutes;
    const until = NOON + (first + 2) * MINUTE + 30_000;
    const segments = generateSegments(NOON, until, scripted([0, 0]));
    expect(segments).toHaveLength(1);
    expect(segments[0]?.endedAt).toBe(NOON + first * MINUTE);
  });

  it('returns nothing when the window is already closed', () => {
    expect(generateSegments(NOON, NOON, mulberry32(1))).toEqual([]);
  });
});

describe('demoActivity', () => {
  it('covers the retention window, oldest day first', () => {
    const history = demoActivity(NOON);
    expect(history.length).toBeGreaterThan(20);
    const dates = history.map((day) => day.date);
    expect([...dates].sort()).toEqual(dates);
    expect(dates.at(-1)).toBe(dateKey(NOON));
  });

  it('stops today at the clock rather than running into the evening', () => {
    const history = demoActivity(NOON);
    const today = history.find((day) => day.date === dateKey(NOON)) as ActivityDay;
    for (const segment of today.segments) {
      expect(segment.endedAt).toBeLessThanOrEqual(NOON);
    }
  });

  it('lets earlier days run past the hour that today stops at', () => {
    const history = demoActivity(NOON);
    const earlier = history.filter((day) => day.date !== dateKey(NOON));
    const latest = Math.max(
      ...earlier.map((day) => {
        const end = day.segments.at(-1)?.endedAt ?? 0;
        return end - startOfDay(end);
      }),
    );
    expect(latest).toBeGreaterThan(12 * 60 * MINUTE);
  });

  it('omits a day with no room to browse instead of listing it empty', () => {
    // Midnight leaves nothing between the morning start and the same instant.
    const midnight = startOfDay(NOON);
    const history = demoActivity(midnight, 1);
    expect(history).toEqual([]);
  });

  it('generates the same history twice over', () => {
    expect(demoActivity(NOON, 5)).toEqual(demoActivity(NOON, 5));
  });

  it('defaults to the full retention window', () => {
    expect(demoActivity(NOON).length).toBeLessThanOrEqual(DEMO_DAYS);
  });
});

describe('demoUsage', () => {
  it('measures today from today, using the same matcher as the worker', () => {
    const rules = demoRules(NOON);
    const history = demoActivity(NOON);
    const today = history.find((day) => day.date === dateKey(NOON)) as ActivityDay;
    const usage = demoUsage(rules, history, NOON);

    expect(usage.date).toBe(dateKey(NOON));
    for (const rule of rules) {
      const expected = today.segments
        .filter((segment) => ruleMatches(rule, segment.url))
        .reduce((sum, segment) => sum + (segment.endedAt - segment.startedAt) / 1000, 0);
      if (expected > 0) {
        expect(usage.seconds[rule.id]).toBe(Math.min(expected, limitSeconds(rule)));
      }
    }
  });

  it('never reports more than the limit, so nothing looks overrun', () => {
    const rules = [{ id: 'r1', pattern: 'a\\.com', limitMinutes: 1, createdAt: 0 }];
    const history: ActivityDay[] = [
      {
        date: dateKey(NOON),
        segments: [{ url: 'https://a.com/', host: 'a.com', startedAt: NOON, endedAt: NOON + 30 * MINUTE }],
      },
    ];
    expect(demoUsage(rules, history, NOON).seconds).toEqual({ r1: 60 });
  });

  it('leaves an untouched rule out of usage entirely', () => {
    const rules = [{ id: 'r1', pattern: 'nowhere\\.example', limitMinutes: 10, createdAt: 0 }];
    expect(demoUsage(rules, demoActivity(NOON), NOON).seconds).toEqual({});
  });

  it('reports nothing when there is no history for today', () => {
    const rules = demoRules(NOON);
    expect(demoUsage(rules, [], NOON).seconds).toEqual({});
  });
});

describe('demoRules', () => {
  it('opens with three rules, dated before today so they look established', () => {
    const rules = demoRules(NOON);
    expect(rules).toHaveLength(3);
    for (const rule of rules) {
      expect(rule.createdAt).toBeLessThan(startOfDay(NOON));
      expect(rule.limitMinutes).toBeGreaterThan(0);
    }
  });

  it('uses patterns that match the hosts it generates browsing for', () => {
    const hosts = DEMO_HOSTS.map((host) => `https://${host.host}${host.path}`);
    for (const rule of demoRules(NOON)) {
      expect(hosts.some((url) => ruleMatches(rule, url))).toBe(true);
    }
  });
});

describe('demoNow', () => {
  it('keeps today\u2019s date but holds the clock in the evening', () => {
    const at = demoNow(NOON);
    expect(dateKey(at)).toBe(dateKey(NOON));
    expect(at - startOfDay(NOON)).toBe(DEMO_CLOCK_MINUTES * MINUTE);
  });

  it('reads the real clock when not given one', () => {
    expect(dateKey(demoNow())).toBe(dateKey(Date.now()));
  });
});

describe('demoSeed', () => {
  it('returns storage the tracker can read straight away, agreeing with itself', () => {
    const seed = demoSeed(NOON);
    expect(seed.rules).toEqual(demoRules(NOON));
    expect(seed.activity).toEqual(demoActivity(NOON));
    expect(seed.usage).toEqual(demoUsage(seed.rules, seed.activity, NOON));
  });
});
