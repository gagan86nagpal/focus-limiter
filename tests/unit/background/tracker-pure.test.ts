import { describe, expect, it } from 'vitest';
import {
  blockedPageUrl,
  sessionSeconds,
  settle,
  toRuleView,
  usedSeconds,
} from '../../../src/background/tracker';
import { installChromeMock } from '../../helpers/chrome-mock';
import type { Rule, Session, UsageDay } from '../../../src/shared/types';

const NOON = new Date(2026, 8, 14, 12, 0, 0).getTime();
const session = (over: Partial<Session> = {}): Session => ({
  tabId: 1,
  url: 'https://x.com',
  ruleIds: ['r1'],
  startedAt: NOON,
  ...over,
});

describe('blockedPageUrl', () => {
  it('builds an extension URL carrying the rule id and original url', () => {
    installChromeMock();
    const url = blockedPageUrl('r1', 'https://x.com/a?b=c');
    expect(url).toContain('chrome-extension://test-extension-id/blocked.html?');
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('rule')).toBe('r1');
    expect(params.get('url')).toBe('https://x.com/a?b=c');
  });
});

describe('sessionSeconds', () => {
  it('counts elapsed seconds since the session started', () => {
    expect(sessionSeconds(session(), NOON + 30_000)).toBe(30);
  });

  it('clamps to zero when now precedes the start', () => {
    expect(sessionSeconds(session(), NOON - 5_000)).toBe(0);
  });

  it('only counts time falling on the current day', () => {
    const beforeMidnight = new Date(2026, 8, 13, 23, 0, 0).getTime();
    const now = new Date(2026, 8, 14, 0, 0, 30).getTime();
    expect(sessionSeconds(session({ startedAt: beforeMidnight }), now)).toBe(30);
  });
});

describe('settle', () => {
  it('adds elapsed time to each of the session rules', () => {
    const usage: UsageDay = { date: '2026-09-14', seconds: { r1: 10 } };
    const result = settle(usage, session({ ruleIds: ['r1', 'r2'] }), NOON + 20_000);
    expect(result.seconds).toEqual({ r1: 30, r2: 20 });
    expect(usage.seconds).toEqual({ r1: 10 });
  });
});

describe('usedSeconds', () => {
  const usage: UsageDay = { date: '2026-09-14', seconds: { r1: 60 } };

  it('returns stored seconds when there is no active session', () => {
    expect(usedSeconds(usage, null, 'r1', NOON)).toBe(60);
  });

  it('adds live session time for a tracked rule', () => {
    expect(usedSeconds(usage, session(), 'r1', NOON + 15_000)).toBe(75);
  });

  it('ignores session time for an untracked rule', () => {
    expect(usedSeconds(usage, session({ ruleIds: ['other'] }), 'r1', NOON + 15_000)).toBe(60);
  });

  it('treats a missing rule as zero', () => {
    expect(usedSeconds(usage, null, 'missing', NOON)).toBe(0);
  });
});

describe('toRuleView', () => {
  const rule: Rule = { id: 'r1', pattern: 'x', limitMinutes: 5, createdAt: NOON };

  it('marks a rule as reached when usage meets the limit', () => {
    const usage: UsageDay = { date: '2026-09-14', seconds: { r1: 300 } };
    const view = toRuleView(rule, usage, null, NOON);
    expect(view.usedSeconds).toBe(300);
    expect(view.limitReached).toBe(true);
  });

  it('marks a rule as not reached below the limit', () => {
    const usage: UsageDay = { date: '2026-09-14', seconds: { r1: 120 } };
    expect(toRuleView(rule, usage, null, NOON).limitReached).toBe(false);
  });
});
