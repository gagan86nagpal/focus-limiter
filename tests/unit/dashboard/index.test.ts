import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPageBody } from '../../helpers/dom';
import { installChromeMock, type ChromeMock } from '../../helpers/chrome-mock';

describe('dashboard entry', () => {
  let chromeMock: ChromeMock;

  beforeEach(() => {
    vi.useFakeTimers();
    chromeMock = installChromeMock();
    loadPageBody('dashboard.html');
    chromeMock.runtime.sendMessage = vi.fn(async () => ({ rules: [], maxRules: 10 }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('boots the dashboard and requests initial state', async () => {
    vi.resetModules();
    await import('../../../src/dashboard/index');
    await vi.advanceTimersByTimeAsync(1);
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({ type: 'getState' });
    expect(document.getElementById('rule-count')?.textContent).toBe('0 of 10');
  });

  it('loads activity only once its tab is opened', async () => {
    const activityView = {
      date: '2026-09-14',
      minDate: '2026-08-16',
      maxDate: '2026-09-14',
      totalSeconds: 0,
      coveredSeconds: 0,
      hostCount: 0,
      peakMinute: null,
      hourly: Array.from({ length: 24 }, () => 0),
      minutes: [],
      top: [],
      datesWithData: [],
    };
    chromeMock.runtime.sendMessage = vi.fn(async (message: { type: string }) =>
      message.type === 'getActivity' ? activityView : { rules: [], maxRules: 10 },
    );

    vi.resetModules();
    await import('../../../src/dashboard/index');
    await vi.advanceTimersByTimeAsync(1);
    expect(chromeMock.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'getActivity' }),
    );

    document.getElementById('tab-activity')?.click();
    await vi.advanceTimersByTimeAsync(1);

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'getActivity' }),
    );
  });

  it('refreshes the rules tab after a rule is created from activity', async () => {
    const activityView = {
      date: '2026-09-14',
      minDate: '2026-08-16',
      maxDate: '2026-09-14',
      totalSeconds: 600,
      coveredSeconds: 0,
      hostCount: 1,
      peakMinute: 540,
      hourly: Array.from({ length: 24 }, () => 0),
      minutes: [{ minute: 540, activeSeconds: 60, host: 'x.com' }],
      top: [
        {
          host: 'x.com',
          url: 'https://x.com/home',
          seconds: 600,
          visits: 2,
          share: 1,
          hourly: Array.from({ length: 24 }, () => 0),
          suggestedPattern: 'x\\.com',
          hasRule: false,
        },
      ],
      datesWithData: ['2026-09-14'],
    };
    const send = vi.fn(async (message: { type: string }) => {
      if (message.type === 'getActivity') return activityView;
      if (message.type === 'createRule') return { ok: true };
      return { rules: [], maxRules: 10 };
    });
    chromeMock.runtime.sendMessage = send;

    vi.resetModules();
    await import('../../../src/dashboard/index');
    await vi.advanceTimersByTimeAsync(1);
    document.getElementById('tab-activity')?.click();
    await vi.advanceTimersByTimeAsync(1);

    const stateCalls = () => send.mock.calls.filter(([m]) => (m as { type: string }).type === 'getState').length;
    const before = stateCalls();
    document.querySelector<HTMLButtonElement>('[data-action="block"]')?.click();
    await vi.advanceTimersByTimeAsync(1);

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'createRule' }));
    expect(stateCalls()).toBeGreaterThan(before);
  });
});
