import { describe, expect, it, vi } from 'vitest';
import { handleMessage } from '../../../src/background/handlers';
import type { Tracker } from '../../../src/background/tracker';

function stubTracker(): Tracker {
  return {
    start: vi.fn(),
    reconcile: vi.fn(),
    setFocused: vi.fn(),
    setIdle: vi.fn(),
    getState: vi.fn(async () => ({ rules: [], maxRules: 10 })),
    createRule: vi.fn(async () => ({ ok: true, rule: { id: 'r', pattern: 'x', limitMinutes: 5, createdAt: 0 } })),
    updateRule: vi.fn(async () => ({ ok: true, rule: { id: 'r', pattern: 'x', limitMinutes: 5, createdAt: 0 } })),
    deleteRule: vi.fn(async () => ({ ok: true })),
    extendLimit: vi.fn(async () => ({
      ok: true,
      rule: { id: 'r', pattern: 'x', limitMinutes: 10, createdAt: 0, usedSeconds: 0, limitReached: false },
    })),
    isTicking: vi.fn(() => false),
  } as unknown as Tracker;
}

describe('handleMessage', () => {
  it('routes getState', async () => {
    const tracker = stubTracker();
    await handleMessage(tracker, { type: 'getState' });
    expect(tracker.getState).toHaveBeenCalled();
  });

  it('routes createRule with its input', async () => {
    const tracker = stubTracker();
    await handleMessage(tracker, { type: 'createRule', input: { pattern: 'x', limitMinutes: 5 } });
    expect(tracker.createRule).toHaveBeenCalledWith({ pattern: 'x', limitMinutes: 5 });
  });

  it('routes updateRule with id and input', async () => {
    const tracker = stubTracker();
    await handleMessage(tracker, { type: 'updateRule', id: 'r1', input: { pattern: 'x', limitMinutes: 5 } });
    expect(tracker.updateRule).toHaveBeenCalledWith('r1', { pattern: 'x', limitMinutes: 5 });
  });

  it('routes deleteRule', async () => {
    const tracker = stubTracker();
    await handleMessage(tracker, { type: 'deleteRule', id: 'r1' });
    expect(tracker.deleteRule).toHaveBeenCalledWith('r1');
  });

  it('routes extendLimit', async () => {
    const tracker = stubTracker();
    await handleMessage(tracker, { type: 'extendLimit', id: 'r1', minutes: 5 });
    expect(tracker.extendLimit).toHaveBeenCalledWith('r1', 5);
  });

  it('returns a structured error for an unknown message', async () => {
    const tracker = stubTracker();
    expect(await handleMessage(tracker, { type: 'nonsense' })).toEqual({ ok: false, error: 'Unknown message' });
  });
});
