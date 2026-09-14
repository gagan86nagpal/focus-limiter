import type { RuleResult, RuleViewResult } from '../shared/messages';
import {
  ERRORS,
  MAX_LIMIT_MINUTES,
  MAX_RULES,
  isTrackableUrl,
  limitSeconds,
  ruleMatches,
  validateRuleInput,
} from '../shared/rules';
import { startOfDay } from '../shared/time';
import type { Rule, RuleView, Session, StateView, UsageDay } from '../shared/types';
import { loadData, loadRuntime, saveData, saveRuntime, saveUsage } from './store';

export const ENFORCE_ALARM = 'focus-limiter:enforce';
export const HEARTBEAT_ALARM = 'focus-limiter:heartbeat';
export const HEARTBEAT_MINUTES = 0.5;
export const BLOCKED_PAGE = 'blocked.html';

export function blockedPageUrl(ruleId: string, originalUrl: string): string {
  const params = new URLSearchParams({ rule: ruleId, url: originalUrl });
  return chrome.runtime.getURL(`${BLOCKED_PAGE}?${params.toString()}`);
}

/** Seconds elapsed in a session up to `now`, counting only the part that falls on today. */
export function sessionSeconds(session: Session, now: number): number {
  const from = Math.max(session.startedAt, startOfDay(now));
  return Math.max(0, now - from) / 1000;
}

/** Folds an active session into the day's usage. */
export function settle(usage: UsageDay, session: Session, now: number): UsageDay {
  const elapsed = sessionSeconds(session, now);
  const seconds = { ...usage.seconds };
  for (const id of session.ruleIds) {
    seconds[id] = (seconds[id] ?? 0) + elapsed;
  }
  return { date: usage.date, seconds };
}

export function usedSeconds(usage: UsageDay, session: Session | null, ruleId: string, now: number): number {
  const base = usage.seconds[ruleId] ?? 0;
  if (session !== null && session.ruleIds.includes(ruleId)) {
    return base + sessionSeconds(session, now);
  }
  return base;
}

export function toRuleView(rule: Rule, usage: UsageDay, session: Session | null, now: number): RuleView {
  const used = usedSeconds(usage, session, rule.id, now);
  return { ...rule, usedSeconds: used, limitReached: used >= limitSeconds(rule) };
}

export interface TrackerOptions {
  now?: () => number;
  tickMs?: number;
}

export type Tracker = ReturnType<typeof createTracker>;

export function createTracker(options: TrackerOptions = {}) {
  const now = options.now ?? Date.now;
  const tickMs = options.tickMs ?? 1000;

  // Event handlers can fire back-to-back; serialise all read-modify-write work.
  let queue: Promise<unknown> = Promise.resolve();
  let deadline: number | null = null;
  let ticker: ReturnType<typeof setInterval> | null = null;

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  function startTicker(): void {
    if (ticker === null) {
      ticker = setInterval(() => void tick(), tickMs);
    }
  }

  function stopTicker(): void {
    if (ticker !== null) {
      clearInterval(ticker);
      ticker = null;
    }
  }

  /** While a session is active, poll storage (which keeps the worker alive) and enforce the deadline precisely. */
  async function tick(): Promise<void> {
    const { session } = await loadRuntime();
    if (session === null) {
      stopTicker();
      return;
    }
    if (deadline !== null && now() >= deadline) {
      await reconcile();
    }
  }

  async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab;
  }

  /**
   * The heart of the extension. Settles the previous session into usage, then looks at the
   * focused tab: block it if a matching rule is exhausted, otherwise start a new session.
   */
  async function reconcileNow(): Promise<void> {
    const at = now();
    const runtime = await loadRuntime();
    const data = await loadData(at);
    if (runtime.session !== null) {
      data.usage = settle(data.usage, runtime.session, at);
    }

    let session: Session | null = null;
    const tab = runtime.focused && !runtime.idle ? await getActiveTab() : undefined;
    if (tab !== undefined && tab.id !== undefined && isTrackableUrl(tab.url)) {
      const url = tab.url;
      const matched = data.rules.filter((rule) => ruleMatches(rule, url));
      const exceeded = matched.find((rule) => (data.usage.seconds[rule.id] ?? 0) >= limitSeconds(rule));
      if (exceeded !== undefined) {
        // The tab may have closed in the meantime; that is not an error worth surfacing.
        await chrome.tabs.update(tab.id, { url: blockedPageUrl(exceeded.id, url) }).catch(() => undefined);
      } else if (matched.length > 0) {
        session = { tabId: tab.id, url, ruleIds: matched.map((rule) => rule.id), startedAt: at };
        const remaining = Math.min(
          ...matched.map((rule) => limitSeconds(rule) - (data.usage.seconds[rule.id] ?? 0)),
        );
        deadline = at + remaining * 1000;
      }
    }

    await saveUsage(data.usage);
    await saveRuntime({ ...runtime, session });

    if (session !== null) {
      await chrome.alarms.create(ENFORCE_ALARM, { when: deadline as number });
      startTicker();
    } else {
      deadline = null;
      await chrome.alarms.clear(ENFORCE_ALARM);
      stopTicker();
    }
  }

  async function readState(): Promise<StateView> {
    const at = now();
    const [runtime, data] = await Promise.all([loadRuntime(), loadData(at)]);
    return {
      rules: data.rules.map((rule) => toRuleView(rule, data.usage, runtime.session, at)),
      maxRules: MAX_RULES,
    };
  }

  function reconcile(): Promise<void> {
    return enqueue(reconcileNow);
  }

  /** Called on install and browser startup. */
  function start(): Promise<void> {
    return enqueue(async () => {
      await chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: HEARTBEAT_MINUTES });
      await reconcileNow();
    });
  }

  function setFocused(focused: boolean): Promise<void> {
    return enqueue(async () => {
      const runtime = await loadRuntime();
      await saveRuntime({ ...runtime, focused });
      await reconcileNow();
    });
  }

  function setIdle(idle: boolean): Promise<void> {
    return enqueue(async () => {
      const runtime = await loadRuntime();
      await saveRuntime({ ...runtime, idle });
      await reconcileNow();
    });
  }

  function getState(): Promise<StateView> {
    return enqueue(readState);
  }

  function createRule(input: { pattern: unknown; limitMinutes: unknown }): Promise<RuleResult> {
    return enqueue(async () => {
      const at = now();
      const data = await loadData(at);
      if (data.rules.length >= MAX_RULES) {
        return { ok: false, error: ERRORS.tooManyRules };
      }
      const validation = validateRuleInput(input);
      if (!validation.ok) {
        return { ok: false, error: validation.message, errors: validation.errors };
      }
      const rule: Rule = { id: crypto.randomUUID(), ...validation.value, createdAt: at };
      await saveData({ ...data, rules: [...data.rules, rule] });
      await reconcileNow();
      return { ok: true, rule };
    });
  }

  function updateRule(id: string, input: { pattern: unknown; limitMinutes: unknown }): Promise<RuleResult> {
    return enqueue(async () => {
      const data = await loadData(now());
      const existing = data.rules.find((rule) => rule.id === id);
      if (existing === undefined) {
        return { ok: false, error: ERRORS.ruleNotFound };
      }
      const validation = validateRuleInput(input);
      if (!validation.ok) {
        return { ok: false, error: validation.message, errors: validation.errors };
      }
      const rule: Rule = { ...existing, ...validation.value };
      await saveData({ ...data, rules: data.rules.map((r) => (r.id === id ? rule : r)) });
      await reconcileNow();
      return { ok: true, rule };
    });
  }

  function deleteRule(id: string): Promise<{ ok: true }> {
    return enqueue(async () => {
      const data = await loadData(now());
      const seconds = { ...data.usage.seconds };
      delete seconds[id];
      await saveData({
        rules: data.rules.filter((rule) => rule.id !== id),
        usage: { date: data.usage.date, seconds },
      });
      await reconcileNow();
      return { ok: true };
    });
  }

  function extendLimit(id: string, minutes: number): Promise<RuleViewResult> {
    return enqueue(async () => {
      const at = now();
      const data = await loadData(at);
      const existing = data.rules.find((rule) => rule.id === id);
      if (existing === undefined) {
        return { ok: false, error: ERRORS.ruleNotFound };
      }
      if (!Number.isInteger(minutes) || minutes <= 0) {
        return { ok: false, error: ERRORS.limitInvalid };
      }
      const rule: Rule = {
        ...existing,
        limitMinutes: Math.min(MAX_LIMIT_MINUTES, existing.limitMinutes + minutes),
      };
      await saveData({ ...data, rules: data.rules.map((r) => (r.id === id ? rule : r)) });
      await reconcileNow();
      const state = await readState();
      return { ok: true, rule: state.rules.find((r) => r.id === id) as RuleView };
    });
  }

  return {
    start,
    reconcile,
    setFocused,
    setIdle,
    getState,
    createRule,
    updateRule,
    deleteRule,
    extendLimit,
    /** Exposed for tests. */
    isTicking: () => ticker !== null,
  };
}
