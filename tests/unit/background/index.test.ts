import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, makeTab, type ChromeMock } from '../../helpers/chrome-mock';

async function loadEntry(): Promise<typeof import('../../../src/background/index')> {
  vi.resetModules();
  return import('../../../src/background/index');
}

describe('background entry', () => {
  let chromeMock: ChromeMock;

  beforeEach(() => {
    chromeMock = installChromeMock();
    vi.useFakeTimers();
  });

  it('registers a tracker and wires all Chrome events', async () => {
    const { registerBackground } = await loadEntry();
    const tracker = {
      start: vi.fn(),
      reconcile: vi.fn(),
      setFocused: vi.fn(),
      setIdle: vi.fn(),
      getState: vi.fn(async () => ({ rules: [], maxRules: 10 })),
      createRule: vi.fn(),
      updateRule: vi.fn(),
      deleteRule: vi.fn(),
      extendLimit: vi.fn(),
      isTicking: vi.fn(),
    } as never;

    const returned = registerBackground(tracker);
    expect(returned).toBe(tracker);

    chromeMock.runtime.onInstalled.emit();
    chromeMock.runtime.onStartup.emit();
    expect((tracker as { start: ReturnType<typeof vi.fn> }).start).toHaveBeenCalledTimes(2);

    const reconcile = (tracker as { reconcile: ReturnType<typeof vi.fn> }).reconcile;
    const before = reconcile.mock.calls.length;
    chromeMock.tabs.onActivated.emit({ tabId: 1, windowId: 1 });
    chromeMock.tabs.onUpdated.emit(1, { url: 'https://x.com' });
    chromeMock.tabs.onUpdated.emit(1, { status: 'loading' }); // no url → ignored
    chromeMock.tabs.onRemoved.emit(1);
    expect(reconcile.mock.calls.length).toBe(before + 3);

    const setFocused = (tracker as { setFocused: ReturnType<typeof vi.fn> }).setFocused;
    chromeMock.windows.onFocusChanged.emit(5);
    chromeMock.windows.onFocusChanged.emit(chromeMock.windows.WINDOW_ID_NONE);
    expect(setFocused).toHaveBeenNthCalledWith(1, true);
    expect(setFocused).toHaveBeenNthCalledWith(2, false);

    const setIdle = (tracker as { setIdle: ReturnType<typeof vi.fn> }).setIdle;
    chromeMock.idle.onStateChanged.emit('idle');
    chromeMock.idle.onStateChanged.emit('active');
    expect(setIdle).toHaveBeenNthCalledWith(1, true);
    expect(setIdle).toHaveBeenNthCalledWith(2, false);

    const reconcileCount = reconcile.mock.calls.length;
    chromeMock.alarms.onAlarm.emit({ name: 'focus-limiter:enforce' } as chrome.alarms.Alarm);
    chromeMock.alarms.onAlarm.emit({ name: 'focus-limiter:heartbeat' } as chrome.alarms.Alarm);
    chromeMock.alarms.onAlarm.emit({ name: 'other' } as chrome.alarms.Alarm); // ignored
    expect(reconcile.mock.calls.length).toBe(reconcileCount + 2);

    chromeMock.action.onClicked.emit();
    expect(chromeMock.runtime.openOptionsPage).toHaveBeenCalled();
  });

  it('answers runtime messages asynchronously and keeps the channel open', async () => {
    await loadEntry();
    const listener = chromeMock.runtime.onMessage.listeners[0];
    expect(listener).toBeDefined();
    const sendResponse = vi.fn();
    const kept = listener!({ type: 'getState' }, {}, sendResponse);
    expect(kept).toBe(true);
    await vi.runAllTimersAsync();
    expect(sendResponse).toHaveBeenCalledWith({ rules: [], maxRules: 10 });
  });

  it('reconciles once on load to recover after a worker restart', async () => {
    chromeMock.tabs._tabs.push(makeTab({ url: 'https://safe.com' }));
    await loadEntry();
    await vi.runAllTimersAsync();
    // The default tracker created at import time reconciled without error.
    expect(chromeMock.storage.session.set).toHaveBeenCalled();
  });
});
