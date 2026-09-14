import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ENFORCE_ALARM,
  HEARTBEAT_ALARM,
  createTracker,
  isAway,
  type Tracker,
} from '../../../src/background/tracker';
import {
  loadActivity,
  loadData,
  loadRuntime,
  saveActivity,
  saveData,
  saveRuntime,
} from '../../../src/background/store';
import { installChromeMock, makeTab, type ChromeMock } from '../../helpers/chrome-mock';
import { MAX_LIMIT_MINUTES } from '../../../src/shared/rules';
import { RETENTION_DAYS } from '../../../src/shared/activity';
import { dateKey, shiftDays } from '../../../src/shared/time';
import type { Rule } from '../../../src/shared/types';

const START = new Date(2026, 8, 14, 12, 0, 0).getTime();
const mkRule = (over: Partial<Rule> = {}): Rule => ({
  id: 'r1',
  pattern: 'x\\.com',
  limitMinutes: 5,
  createdAt: START,
  ...over,
});

let chromeMock: ChromeMock;
let clock: number;
let tracker: Tracker;

function setActiveTab(tab: chrome.tabs.Tab | null): void {
  chromeMock.tabs._tabs.length = 0;
  if (tab !== null) chromeMock.tabs._tabs.push(tab);
}

function newTracker(): Tracker {
  return createTracker({ now: () => clock, tickMs: 1000 });
}

beforeEach(() => {
  vi.useFakeTimers();
  chromeMock = installChromeMock();
  clock = START;
  tracker = newTracker();
});

afterEach(() => {
  vi.clearAllTimers();
});

describe('start', () => {
  it('registers the heartbeat alarm and reconciles', async () => {
    setActiveTab(null);
    await tracker.start();
    expect(chromeMock.alarms.create).toHaveBeenCalledWith(
      HEARTBEAT_ALARM,
      expect.objectContaining({ periodInMinutes: expect.any(Number) }),
    );
    expect((await loadRuntime()).session).toBeNull();
  });
});

describe('session lifecycle', () => {
  it('starts a session on a matching, tracked tab', async () => {
    await saveData({ rules: [mkRule()], usage: { date: '2026-09-14', seconds: {} } });
    setActiveTab(makeTab({ id: 7, url: 'https://x.com/home' }));

    await tracker.reconcile();

    const runtime = await loadRuntime();
    expect(runtime.session).toMatchObject({ tabId: 7, ruleIds: ['r1'] });
    expect(chromeMock.alarms.create).toHaveBeenCalledWith(ENFORCE_ALARM, expect.objectContaining({ when: expect.any(Number) }));
    expect(tracker.isTicking()).toBe(true);
  });

  it('tracks the active tab when Chrome reports no last-focused window', async () => {
    await saveData({ rules: [mkRule()], usage: { date: '2026-09-14', seconds: {} } });
    setActiveTab(makeTab({ id: 7, url: 'https://x.com/home' }));
    chromeMock.tabs.query.mockImplementation(async (info: chrome.tabs.QueryInfo) => {
      if (info.lastFocusedWindow === true) return [];
      return chromeMock.tabs._tabs.filter((tab) => info.active !== true || tab.active);
    });

    await tracker.reconcile();

    expect((await loadRuntime()).session).toMatchObject({ tabId: 7, ruleIds: ['r1'] });
  });

  it('accrues usage when the session ends', async () => {
    await saveData({ rules: [mkRule()], usage: { date: '2026-09-14', seconds: {} } });
    setActiveTab(makeTab({ id: 7, url: 'https://x.com/home' }));
    await tracker.reconcile();

    clock += 90_000; // 90 seconds pass
    setActiveTab(makeTab({ id: 7, url: 'https://safe.com' }));
    await tracker.reconcile();

    const data = await loadData(clock);
    expect(data.usage.seconds['r1']).toBeCloseTo(90, 3);
    // The unruled page still gets a session so activity can record it, but it accrues nothing.
    expect((await loadRuntime()).session?.ruleIds).toEqual([]);
    expect(tracker.isTicking()).toBe(false);
    expect(chromeMock.alarms.clear).toHaveBeenCalledWith(ENFORCE_ALARM);
  });

  it('picks the smallest remaining budget when several rules match', async () => {
    await saveData({
      rules: [mkRule({ id: 'r1', limitMinutes: 10 }), mkRule({ id: 'r2', pattern: 'x', limitMinutes: 2 })],
      usage: { date: '2026-09-14', seconds: {} },
    });
    setActiveTab(makeTab({ id: 7, url: 'https://x.com/home' }));
    await tracker.reconcile();
    const runtime = await loadRuntime();
    expect(runtime.session?.ruleIds).toEqual(['r1', 'r2']);
  });
});

describe('reconcile persistence', () => {
  it('never writes the rules key, so a concurrent rule edit cannot be lost', async () => {
    await saveData({ rules: [mkRule()], usage: { date: '2026-09-14', seconds: {} } });
    setActiveTab(makeTab({ id: 7, url: 'https://x.com/home' }));
    chromeMock.storage.local.set.mockClear();

    await tracker.reconcile();

    const written = chromeMock.storage.local.set.mock.calls.flatMap(([items]) =>
      Object.keys(items as Record<string, unknown>),
    );
    expect(written).not.toContain('rules');
    expect(written).toContain('usage');
  });

  it('keeps a rule that was stored while reconcile was in flight', async () => {
    await saveData({ rules: [], usage: { date: '2026-09-14', seconds: {} } });
    setActiveTab(makeTab({ id: 7, url: 'https://x.com/home' }));

    // Land a rule write between reconcile's read and its write-back.
    const realGet = chromeMock.storage.local.get;
    chromeMock.storage.local.get = vi.fn(async (keys?: string[] | string | null) => {
      const result = await realGet(keys);
      chromeMock.storage.local.get = realGet;
      await chromeMock.storage.local.set({ rules: [mkRule()] });
      return result;
    }) as typeof realGet;

    await tracker.reconcile();

    expect((await loadData(clock)).rules).toEqual([mkRule()]);
  });
});

describe('blocking', () => {
  it('redirects to the blocked page when a matching rule is exhausted', async () => {
    await saveData({ rules: [mkRule()], usage: { date: '2026-09-14', seconds: { r1: 300 } } });
    setActiveTab(makeTab({ id: 9, url: 'https://x.com/home' }));

    await tracker.reconcile();

    expect(chromeMock.tabs.update).toHaveBeenCalledWith(9, {
      url: expect.stringContaining('blocked.html'),
    });
    expect((await loadRuntime()).session).toBeNull();
  });

  it('does not throw when the tab vanishes during the redirect', async () => {
    chromeMock.tabs.update = vi.fn(async () => {
      throw new Error('No tab with id');
    });
    await saveData({ rules: [mkRule()], usage: { date: '2026-09-14', seconds: { r1: 300 } } });
    setActiveTab(makeTab({ id: 9, url: 'https://x.com/home' }));

    await expect(tracker.reconcile()).resolves.toBeUndefined();
  });
});

describe('isAway', () => {
  it('treats a locked screen as away whatever the tab is doing', () => {
    expect(isAway('locked', false)).toBe(true);
    expect(isAway('locked', true)).toBe(true);
  });

  it('treats a quiet keyboard as away only while the tab is silent', () => {
    expect(isAway('idle', false)).toBe(true);
    expect(isAway('idle', true)).toBe(false);
  });

  it('is never away while the machine is active', () => {
    expect(isAway('active', false)).toBe(false);
    expect(isAway('active', true)).toBe(false);
  });
});

describe('reconcile guards', () => {
  it('does not track when the window is unfocused', async () => {
    await saveData({ rules: [mkRule()], usage: { date: '2026-09-14', seconds: {} } });
    setActiveTab(makeTab({ id: 7, url: 'https://x.com/home' }));
    await tracker.setFocused(false);
    expect((await loadRuntime()).session).toBeNull();
  });

  it('does not track a silent tab once the machine goes idle', async () => {
    await saveData({ rules: [mkRule()], usage: { date: '2026-09-14', seconds: {} } });
    setActiveTab(makeTab({ id: 7, url: 'https://x.com/home' }));
    await tracker.setPresence('idle');
    expect((await loadRuntime()).session).toBeNull();
  });

  it('keeps tracking an audible tab while the machine is idle', async () => {
    // Watching a video sends no keyboard or mouse input, so chrome.idle calls it idle even
    // though this is exactly the browsing a limit is meant to catch.
    await saveData({ rules: [mkRule()], usage: { date: '2026-09-14', seconds: {} } });
    setActiveTab(makeTab({ id: 7, url: 'https://x.com/home', audible: true }));
    await tracker.setPresence('idle');
    expect((await loadRuntime()).session).toMatchObject({ tabId: 7, ruleIds: ['r1'] });
    expect(tracker.isTicking()).toBe(true);
  });

  it('stops tracking an audible tab when the screen locks', async () => {
    await saveData({ rules: [mkRule()], usage: { date: '2026-09-14', seconds: {} } });
    setActiveTab(makeTab({ id: 7, url: 'https://x.com/home', audible: true }));
    await tracker.setPresence('locked');
    expect((await loadRuntime()).session).toBeNull();
  });

  it('resumes tracking when the machine becomes active again', async () => {
    await saveData({ rules: [mkRule()], usage: { date: '2026-09-14', seconds: {} } });
    setActiveTab(makeTab({ id: 7, url: 'https://x.com/home' }));
    await tracker.setPresence('idle');
    await tracker.setPresence('active');
    expect((await loadRuntime()).session).not.toBeNull();
  });

  it('resumes tracking when focus returns', async () => {
    await saveData({ rules: [mkRule()], usage: { date: '2026-09-14', seconds: {} } });
    setActiveTab(makeTab({ id: 7, url: 'https://x.com/home' }));
    await tracker.setFocused(false);
    await tracker.setFocused(true);
    expect((await loadRuntime()).session).not.toBeNull();
  });

  it('ignores tabs without an id', async () => {
    await saveData({ rules: [mkRule()], usage: { date: '2026-09-14', seconds: {} } });
    setActiveTab(makeTab({ id: undefined, url: 'https://x.com/home' }));
    await tracker.reconcile();
    expect((await loadRuntime()).session).toBeNull();
  });

  it('ignores non-web URLs', async () => {
    await saveData({ rules: [mkRule()], usage: { date: '2026-09-14', seconds: {} } });
    setActiveTab(makeTab({ id: 7, url: 'chrome://extensions' }));
    await tracker.reconcile();
    expect((await loadRuntime()).session).toBeNull();
  });

  it('starts a rule-less session on a tab that matches no rule', async () => {
    await saveData({ rules: [mkRule()], usage: { date: '2026-09-14', seconds: {} } });
    setActiveTab(makeTab({ id: 7, url: 'https://safe.com' }));
    await tracker.reconcile();
    // Tracked for activity, but with no rule ids it arms no deadline and accrues no usage.
    expect((await loadRuntime()).session).toMatchObject({ tabId: 7, ruleIds: [] });
    expect(tracker.isTicking()).toBe(false);
  });

  it('handles there being no active tab', async () => {
    await saveData({ rules: [mkRule()], usage: { date: '2026-09-14', seconds: {} } });
    setActiveTab(null);
    await tracker.reconcile();
    expect((await loadRuntime()).session).toBeNull();
  });
});

describe('enforcement ticker', () => {
  it('blocks the tab the instant the deadline passes', async () => {
    await saveData({ rules: [mkRule({ limitMinutes: 1 })], usage: { date: '2026-09-14', seconds: {} } });
    setActiveTab(makeTab({ id: 7, url: 'https://x.com/home' }));
    await tracker.reconcile();
    expect(tracker.isTicking()).toBe(true);

    clock += 61_000; // one second past the one-minute budget
    await vi.advanceTimersByTimeAsync(1000);

    expect(chromeMock.tabs.update).toHaveBeenCalledWith(7, { url: expect.stringContaining('blocked.html') });
  });

  it('keeps ticking while the deadline is in the future', async () => {
    await saveData({ rules: [mkRule({ limitMinutes: 5 })], usage: { date: '2026-09-14', seconds: {} } });
    setActiveTab(makeTab({ id: 7, url: 'https://x.com/home' }));
    await tracker.reconcile();

    clock += 1000;
    await vi.advanceTimersByTimeAsync(1000);

    expect(chromeMock.tabs.update).not.toHaveBeenCalled();
    expect(tracker.isTicking()).toBe(true);
  });

  it('stops the ticker when a tick finds no session', async () => {
    await saveData({ rules: [mkRule()], usage: { date: '2026-09-14', seconds: {} } });
    setActiveTab(makeTab({ id: 7, url: 'https://x.com/home' }));
    await tracker.reconcile();
    expect(tracker.isTicking()).toBe(true);

    await saveRuntime({ session: null, focused: true, presence: 'active' });
    await vi.advanceTimersByTimeAsync(1000);

    expect(tracker.isTicking()).toBe(false);
  });

  it('stops the ticker when the deadline is dropped mid-reconcile', async () => {
    await saveData({ rules: [mkRule()], usage: { date: '2026-09-14', seconds: {} } });
    setActiveTab(makeTab({ id: 7, url: 'https://x.com/home' }));
    await tracker.reconcile();
    expect(tracker.isTicking()).toBe(true);

    // Hold the reconcile open after it drops the deadline but before it stops the ticker,
    // so a tick lands in the window where no limit is armed.
    let release = (): void => undefined;
    chromeMock.alarms.clear = vi.fn(
      async () =>
        await new Promise<boolean>((resolve) => {
          release = () => resolve(true);
        }),
    );
    setActiveTab(null);
    const pending = tracker.reconcile();
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(1000);
    expect(tracker.isTicking()).toBe(false);

    release();
    await pending;
  });
});

describe('activity recording', () => {
  it('records a segment for a page that matches no rule', async () => {
    await saveData({ rules: [], usage: { date: '2026-09-14', seconds: {} } });
    setActiveTab(makeTab({ id: 7, url: 'https://www.news.com/story' }));
    await tracker.reconcile();

    clock += 30_000;
    setActiveTab(null);
    await tracker.reconcile();

    const days = await loadActivity();
    expect(days).toHaveLength(1);
    expect(days[0]?.segments).toEqual([
      { url: 'https://www.news.com/story', host: 'news.com', startedAt: START, endedAt: START + 30_000 },
    ]);
  });

  it('merges consecutive reconciles on the same page into one segment', async () => {
    await saveData({ rules: [], usage: { date: '2026-09-14', seconds: {} } });
    setActiveTab(makeTab({ id: 7, url: 'https://news.com/story' }));
    await tracker.reconcile();

    clock += 30_000;
    await tracker.reconcile();
    clock += 30_000;
    await tracker.reconcile();

    const segments = (await loadActivity())[0]?.segments;
    expect(segments).toHaveLength(1);
    expect(segments?.[0]?.endedAt).toBe(START + 60_000);
  });

  it('ignores a glance shorter than a second', async () => {
    await saveData({ rules: [], usage: { date: '2026-09-14', seconds: {} } });
    setActiveTab(makeTab({ id: 7, url: 'https://news.com/story' }));
    await tracker.reconcile();

    clock += 200;
    setActiveTab(null);
    await tracker.reconcile();

    expect(await loadActivity()).toEqual([]);
  });

  it('records nothing when there was no previous session', async () => {
    setActiveTab(null);
    await tracker.reconcile();
    expect(await loadActivity()).toEqual([]);
  });

  it('drops history that falls outside the retention window', async () => {
    const stale = dateKey(shiftDays(START, -(RETENTION_DAYS + 2)));
    await saveActivity([{ date: stale, segments: [] }]);
    await saveData({ rules: [], usage: { date: '2026-09-14', seconds: {} } });
    setActiveTab(makeTab({ id: 7, url: 'https://news.com/story' }));
    await tracker.reconcile();

    clock += 5000;
    setActiveTab(null);
    await tracker.reconcile();

    expect((await loadActivity()).map((day) => day.date)).toEqual(['2026-09-14']);
  });

  it('does not write the rules or usage keys while recording activity', async () => {
    await saveData({ rules: [], usage: { date: '2026-09-14', seconds: {} } });
    setActiveTab(makeTab({ id: 7, url: 'https://news.com/story' }));
    await tracker.reconcile();
    chromeMock.storage.local.set.mockClear();

    clock += 5000;
    setActiveTab(null);
    await tracker.reconcile();

    const activityWrites = chromeMock.storage.local.set.mock.calls
      .map(([items]) => Object.keys(items as Record<string, unknown>))
      .filter((keys) => keys.includes('activity'));
    expect(activityWrites).toEqual([['activity']]);
  });
});

describe('getActivity', () => {
  it('summarises a stored day', async () => {
    await saveActivity([
      {
        date: '2026-09-14',
        segments: [
          { url: 'https://x.com/a', host: 'x.com', startedAt: START, endedAt: START + 120_000 },
          { url: 'https://y.com/b', host: 'y.com', startedAt: START + 120_000, endedAt: START + 180_000 },
        ],
      },
    ]);
    const view = await tracker.getActivity('2026-09-14');
    expect(view.totalSeconds).toBe(180);
    expect(view.hostCount).toBe(2);
    expect(view.top.map((entry) => entry.host)).toEqual(['x.com', 'y.com']);
  });

  it('flags a host an existing rule already covers', async () => {
    await saveData({ rules: [mkRule()], usage: { date: '2026-09-14', seconds: {} } });
    await saveActivity([
      {
        date: '2026-09-14',
        segments: [{ url: 'https://x.com/a', host: 'x.com', startedAt: START, endedAt: START + 60_000 }],
      },
    ]);
    const view = await tracker.getActivity('2026-09-14');
    expect(view.top[0]?.hasRule).toBe(true);
  });

  it('folds the in-flight session in so the day reaches now', async () => {
    await saveData({ rules: [], usage: { date: '2026-09-14', seconds: {} } });
    setActiveTab(makeTab({ id: 7, url: 'https://live.com/now' }));
    await tracker.reconcile();

    clock += 45_000;
    const view = await tracker.getActivity('2026-09-14');
    expect(view.totalSeconds).toBe(45);
    expect(view.top[0]?.host).toBe('live.com');
  });

  it('ignores an in-flight session that has barely started', async () => {
    await saveData({ rules: [], usage: { date: '2026-09-14', seconds: {} } });
    setActiveTab(makeTab({ id: 7, url: 'https://live.com/now' }));
    await tracker.reconcile();

    clock += 100;
    const view = await tracker.getActivity('2026-09-14');
    expect(view.totalSeconds).toBe(0);
    expect(view.top).toEqual([]);
  });

  it('returns an empty day for a date with no history', async () => {
    setActiveTab(null);
    const view = await tracker.getActivity('2026-09-01');
    expect(view).toMatchObject({ date: '2026-09-01', totalSeconds: 0, hostCount: 0, peakMinute: null });
    expect(view.top).toEqual([]);
  });
});

describe('getState', () => {
  it('returns rule views including live session time', async () => {
    await saveData({ rules: [mkRule()], usage: { date: '2026-09-14', seconds: { r1: 60 } } });
    setActiveTab(makeTab({ id: 7, url: 'https://x.com/home' }));
    await tracker.reconcile();

    clock += 10_000;
    const state = await tracker.getState();
    expect(state.maxRules).toBe(10);
    expect(state.rules[0]?.usedSeconds).toBeCloseTo(70, 3);
  });
});

describe('createRule', () => {
  it('adds a valid rule', async () => {
    setActiveTab(null);
    const result = await tracker.createRule({ pattern: 'a\\.com', limitMinutes: 15 });
    expect(result.ok).toBe(true);
    const data = await loadData(clock);
    expect(data.rules).toHaveLength(1);
    expect(data.rules[0]?.limitMinutes).toBe(15);
  });

  it('rejects a rule when the limit of ten is reached', async () => {
    const rules = Array.from({ length: 10 }, (_, i) => mkRule({ id: `r${i}`, pattern: `p${i}` }));
    await saveData({ rules, usage: { date: '2026-09-14', seconds: {} } });
    const result = await tracker.createRule({ pattern: 'new', limitMinutes: 5 });
    expect(result).toEqual({ ok: false, error: expect.stringContaining('at most 10') });
  });

  it('rejects invalid input with field errors', async () => {
    const result = await tracker.createRule({ pattern: '(', limitMinutes: 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.pattern).toBeDefined();
  });
});

describe('updateRule', () => {
  it('updates an existing rule and re-evaluates', async () => {
    await saveData({ rules: [mkRule()], usage: { date: '2026-09-14', seconds: {} } });
    setActiveTab(null);
    const result = await tracker.updateRule('r1', { pattern: 'y\\.com', limitMinutes: 20 });
    expect(result.ok).toBe(true);
    const data = await loadData(clock);
    expect(data.rules[0]).toMatchObject({ pattern: 'y\\.com', limitMinutes: 20 });
  });

  it('reports when the rule does not exist', async () => {
    const result = await tracker.updateRule('missing', { pattern: 'x', limitMinutes: 5 });
    expect(result).toEqual({ ok: false, error: expect.stringContaining('no longer exists') });
  });

  it('rejects invalid input', async () => {
    await saveData({ rules: [mkRule()], usage: { date: '2026-09-14', seconds: {} } });
    const result = await tracker.updateRule('r1', { pattern: '', limitMinutes: 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.pattern).toBeDefined();
  });
});

describe('deleteRule', () => {
  it('removes the rule and its recorded usage', async () => {
    await saveData({ rules: [mkRule()], usage: { date: '2026-09-14', seconds: { r1: 120 } } });
    setActiveTab(null);
    const result = await tracker.deleteRule('r1');
    expect(result).toEqual({ ok: true });
    const data = await loadData(clock);
    expect(data.rules).toHaveLength(0);
    expect(data.usage.seconds['r1']).toBeUndefined();
  });
});

describe('extendLimit', () => {
  it('adds minutes to the rule and returns the updated view', async () => {
    await saveData({ rules: [mkRule({ limitMinutes: 5 })], usage: { date: '2026-09-14', seconds: { r1: 300 } } });
    setActiveTab(null);
    const result = await tracker.extendLimit('r1', 5);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.limitMinutes).toBe(10);
      expect(result.rule.limitReached).toBe(false);
    }
  });

  it('caps the limit at the daily maximum', async () => {
    await saveData({
      rules: [mkRule({ limitMinutes: MAX_LIMIT_MINUTES - 2 })],
      usage: { date: '2026-09-14', seconds: {} },
    });
    setActiveTab(null);
    const result = await tracker.extendLimit('r1', 10);
    if (result.ok) expect(result.rule.limitMinutes).toBe(MAX_LIMIT_MINUTES);
    else throw new Error('expected success');
  });

  it('reports when the rule is missing', async () => {
    const result = await tracker.extendLimit('missing', 5);
    expect(result).toEqual({ ok: false, error: expect.stringContaining('no longer exists') });
  });

  it('rejects a non-positive or non-integer extension', async () => {
    await saveData({ rules: [mkRule()], usage: { date: '2026-09-14', seconds: {} } });
    expect((await tracker.extendLimit('r1', 0)).ok).toBe(false);
    expect((await tracker.extendLimit('r1', 1.5)).ok).toBe(false);
  });
});

describe('resilience', () => {
  it('recovers the work queue after an internal failure', async () => {
    const original = chromeMock.storage.local.get;
    chromeMock.storage.local.get = vi.fn(async () => {
      throw new Error('storage offline');
    });
    setActiveTab(null);
    await expect(tracker.reconcile()).rejects.toThrow('storage offline');

    chromeMock.storage.local.get = original;
    const result = await tracker.createRule({ pattern: 'ok', limitMinutes: 5 });
    expect(result.ok).toBe(true);
  });
});

describe('branch coverage extras', () => {
  it('does not create a second ticker when reconciling an active session again', async () => {
    await saveData({ rules: [mkRule({ limitMinutes: 5 })], usage: { date: '2026-09-14', seconds: {} } });
    setActiveTab(makeTab({ id: 7, url: 'https://x.com/home' }));
    await tracker.reconcile();
    expect(tracker.isTicking()).toBe(true);
    await tracker.reconcile(); // still the same matching tab
    expect(tracker.isTicking()).toBe(true);
  });

  it('leaves other rules untouched when updating one of several', async () => {
    await saveData({
      rules: [mkRule({ id: 'r1', pattern: 'a' }), mkRule({ id: 'r2', pattern: 'b' })],
      usage: { date: '2026-09-14', seconds: {} },
    });
    setActiveTab(null);
    const result = await tracker.updateRule('r2', { pattern: 'c', limitMinutes: 7 });
    expect(result.ok).toBe(true);
    const data = await loadData(clock);
    expect(data.rules.find((r) => r.id === 'r1')?.pattern).toBe('a');
    expect(data.rules.find((r) => r.id === 'r2')).toMatchObject({ pattern: 'c', limitMinutes: 7 });
  });

  it('leaves other rules untouched when extending one of several', async () => {
    await saveData({
      rules: [mkRule({ id: 'r1', pattern: 'a', limitMinutes: 5 }), mkRule({ id: 'r2', pattern: 'b', limitMinutes: 5 })],
      usage: { date: '2026-09-14', seconds: {} },
    });
    setActiveTab(null);
    const result = await tracker.extendLimit('r2', 5);
    expect(result.ok).toBe(true);
    const data = await loadData(clock);
    expect(data.rules.find((r) => r.id === 'r1')?.limitMinutes).toBe(5);
    expect(data.rules.find((r) => r.id === 'r2')?.limitMinutes).toBe(10);
  });
});

describe('default options', () => {
  it('falls back to Date.now and the default tick interval', async () => {
    installChromeMock();
    const plain = createTracker();
    const state = await plain.getState();
    expect(state.maxRules).toBe(10);
    expect(plain.isTicking()).toBe(false);
  });
});
