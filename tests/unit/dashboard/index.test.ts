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
});
