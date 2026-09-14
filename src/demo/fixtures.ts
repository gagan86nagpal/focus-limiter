/**
 * A believable month of browsing for the public demo.
 *
 * Generated rather than hand-written, because the demo is worth exploring only if moving back
 * through the date picker keeps finding plausible days. Generation is seeded, so every visitor
 * sees the same history and a screenshot taken today still matches tomorrow.
 *
 * Today's usage is derived by running the real `ruleMatches` over today's segments, so the
 * "used today" figures on the Rules tab agree with the chart on the Activity tab instead of
 * being two unrelated sets of invented numbers.
 */
import { limitSeconds, ruleMatches } from '../shared/rules';
import { dateKey, shiftDays, startOfDay } from '../shared/time';
import type { ActivityDay, ActivitySegment, Rule, UsageDay } from '../shared/types';

const MINUTE_MS = 60_000;

/** How many days of history the demo offers, matching the extension's retention window. */
export const DEMO_DAYS = 30;
export const DEMO_SEED = 0x5eed;
/** The minute of the day the demo pretends it is: late enough that today is a full day. */
export const DEMO_CLOCK_MINUTES = 21 * 60 + 40;

/**
 * The demo's clock — today's date, held at a late evening minute.
 *
 * Every part of the dashboard takes `now` as a dependency, so the demo can simply stop it.
 * Running on the real clock meant a visitor arriving before lunch met a nearly empty chart,
 * which is a poor introduction to a product whose entire subject is the shape of a full day.
 * Keeping today's real date, rather than freezing some past one, is what keeps the heading
 * reading "Today" and the date picker's upper bound correct.
 */
export function demoNow(realNow: number = Date.now()): number {
  return startOfDay(realNow) + DEMO_CLOCK_MINUTES * MINUTE_MS;
}

export interface DemoHost {
  host: string;
  path: string;
  /** Relative likelihood of being the next thing visited. */
  weight: number;
  /** Inclusive range for how long one sitting lasts, in minutes. */
  minMinutes: number;
  maxMinutes: number;
}

/**
 * A mix of work and distraction, weighted so the chart has both long blocks of focus and the
 * short scattered visits that make a day feel real.
 */
export const DEMO_HOSTS: readonly DemoHost[] = [
  { host: 'github.com', path: '/pulls', weight: 20, minMinutes: 12, maxMinutes: 45 },
  { host: 'youtube.com', path: '/watch', weight: 12, minMinutes: 6, maxMinutes: 28 },
  { host: 'news.ycombinator.com', path: '/', weight: 11, minMinutes: 3, maxMinutes: 14 },
  { host: 'reddit.com', path: '/r/programming', weight: 10, minMinutes: 4, maxMinutes: 18 },
  { host: 'figma.com', path: '/file/design-review', weight: 9, minMinutes: 15, maxMinutes: 40 },
  { host: 'stackoverflow.com', path: '/questions/71', weight: 8, minMinutes: 3, maxMinutes: 12 },
  { host: 'mail.google.com', path: '/mail/u/0', weight: 8, minMinutes: 4, maxMinutes: 16 },
  { host: 'docs.google.com', path: '/document/d/1', weight: 7, minMinutes: 10, maxMinutes: 32 },
  { host: 'x.com', path: '/home', weight: 7, minMinutes: 3, maxMinutes: 15 },
  { host: 'linear.app', path: '/team/eng', weight: 5, minMinutes: 5, maxMinutes: 20 },
];

/** The rules the demo opens with, covering three of the hosts above. */
export function demoRules(now: number): Rule[] {
  const createdAt = startOfDay(shiftDays(now, -12));
  return [
    // Deliberately mixed: the first is spent, so the demo shows a card in its limit-reached
    // state, while the others are mid-budget and show progress.
    { id: 'demo-youtube', pattern: 'youtube\\.com', limitMinutes: 25, createdAt },
    { id: 'demo-hn', pattern: 'news\\.ycombinator\\.com', limitMinutes: 35, createdAt },
    { id: 'demo-reddit', pattern: 'reddit\\.com', limitMinutes: 45, createdAt },
  ];
}

/**
 * Mulberry32: small, fast, and identical across engines, which is what makes the demo's
 * history reproducible rather than merely random-looking.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Picks a host by weight. */
export function pickHost(rand: () => number, hosts: readonly DemoHost[] = DEMO_HOSTS): DemoHost {
  const total = hosts.reduce((sum, host) => sum + host.weight, 0);
  let remaining = rand() * total;
  let chosen: DemoHost | undefined;
  for (const host of hosts) {
    chosen = host;
    remaining -= host.weight;
    if (remaining <= 0) break;
  }
  if (chosen === undefined) throw new Error('No demo hosts to choose from');
  return chosen;
}

/**
 * Lays out one day as a sequence of sittings separated by gaps.
 *
 * Segments never overlap, because a person looks at one tab at a time and the activity model
 * assumes as much. Anything shorter than a minute is dropped rather than drawn as a sliver.
 */
export function generateSegments(from: number, until: number, rand: () => number): ActivitySegment[] {
  const segments: ActivitySegment[] = [];
  let cursor = from;
  while (cursor < until) {
    const site = pickHost(rand);
    const span = site.minMinutes + Math.floor(rand() * (site.maxMinutes - site.minMinutes + 1));
    const endedAt = Math.min(cursor + span * MINUTE_MS, until);
    if (endedAt - cursor >= MINUTE_MS) {
      segments.push({
        url: `https://${site.host}${site.path}`,
        host: site.host,
        startedAt: cursor,
        endedAt,
      });
    }
    // A gap for meetings, other applications, or simply not being at the desk.
    cursor = endedAt + (2 + Math.floor(rand() * 24)) * MINUTE_MS;
  }
  return segments;
}

/**
 * The rolling history, oldest first. Earlier days run to an evening finish; today stops at
 * `now`, so the chart ends where the clock is rather than running into the future.
 */
export function demoActivity(now: number, days: number = DEMO_DAYS): ActivityDay[] {
  const history: ActivityDay[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const rand = mulberry32(DEMO_SEED + offset);
    const midnight = startOfDay(shiftDays(now, -offset));
    const starts = midnight + (8 * 60 + Math.floor(rand() * 90)) * MINUTE_MS;
    const stops = midnight + (18 * 60 + Math.floor(rand() * 300)) * MINUTE_MS;
    const until = offset === 0 ? Math.min(now, stops) : stops;
    const segments = starts >= until ? [] : generateSegments(starts, until, rand);
    if (segments.length > 0) history.push({ date: dateKey(midnight), segments });
  }
  return history;
}

/**
 * Today's usage, measured from today's segments with the same matcher the worker uses.
 *
 * Totals are capped at each rule's limit so a budget can read as spent without implying the
 * extension let it overrun, which also gives the Rules tab a "Limit reached" card to show.
 */
export function demoUsage(rules: Rule[], history: ActivityDay[], now: number): UsageDay {
  const today = dateKey(now);
  const segments = history.find((day) => day.date === today)?.segments ?? [];
  const seconds: Record<string, number> = {};
  for (const rule of rules) {
    const spent = segments
      .filter((segment) => ruleMatches(rule, segment.url))
      .reduce((sum, segment) => sum + (segment.endedAt - segment.startedAt) / 1000, 0);
    if (spent > 0) seconds[rule.id] = Math.min(spent, limitSeconds(rule));
  }
  return { date: today, seconds };
}

/** Everything the demo needs in storage before the tracker reads it. */
export function demoSeed(now: number): { rules: Rule[]; usage: UsageDay; activity: ActivityDay[] } {
  const rules = demoRules(now);
  const activity = demoActivity(now);
  return { rules, usage: demoUsage(rules, activity, now), activity };
}
