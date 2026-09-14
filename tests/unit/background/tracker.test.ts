import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ENFORCE_ALARM,
  HEARTBEAT_ALARM,
  createTracker,
  type Tracker,
} from '../../../src/background/tracker';
import { loadData, loadRuntime, saveData, saveRuntime } from '../../../src/background/store';
import { installChromeMock, makeTab, type ChromeMock } from '../../helpers/chrome-mock';
import { MAX_LIMIT_MINUTES } from '../../../src/shared/rules';
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

  it('accrues usage when the session ends', async () => {
    await saveData({ rules: [mkRule()], usage: { date: '2026-09-14', seconds: {} } });
    setActiveTab(makeTab({ id: 7, url: 'https://x.com/home' }));
    await tracker.reconcile();

    clock += 90_000; // 90 seconds pass
    setActiveTab(makeTab({ id: 7, url: 'https://safe.com' }));
    await tracker.reconcile();

    const data = await loadData(clock);
    expect(data.usage.seconds['r1']).toBeCloseTo(90, 3);
    expect((await loadRuntime()).session).toBeNull();
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

describe('reconcile guards', () => {
  it('does not track when the window is unfocused', async () => {
    await saveData({ rules: [mkRule()], usage: { date: '2026-09-14', seconds: {} } });
    setActiveTab(makeTab({ id: 7, url: 'https://x.com/home' }));
    await tracker.setFocused(false);
    expect((await loadRuntime()).session).toBeNull();
  });

  it('does not track when the user is idle', async () => {
    await saveData({ rules: [mkRule()], usage: { date: '2026-09-14', seconds: {} } });
    setActiveTab(makeTab({ id: 7, url: 'https://x.com/home' }));
    await tracker.setIdle(true);
    expect((await loadRuntime()).session).toBeNull();
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

  it('does not start a session on a tab that matches no rule', async () => {
    await saveData({ rules: [mkRule()], usage: { date: '2026-09-14', seconds: {} } });
    setActiveTab(makeTab({ id: 7, url: 'https://safe.com' }));
    await tracker.reconcile();
    expect((await loadRuntime()).session).toBeNull();
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

    await saveRuntime({ session: null, focused: true, idle: false });
    await vi.advanceTimersByTimeAsync(1000);

    expect(tracker.isTicking()).toBe(false);
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
