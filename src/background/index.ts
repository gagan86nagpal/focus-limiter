import { handleMessage } from './handlers';
import { ENFORCE_ALARM, HEARTBEAT_ALARM, createTracker, type Tracker } from './tracker';

/** Wires Chrome events to the tracker. Kept thin so the logic in tracker.ts stays testable. */
export function registerBackground(tracker: Tracker = createTracker()): Tracker {
  chrome.runtime.onInstalled.addListener(() => void tracker.start());
  chrome.runtime.onStartup.addListener(() => void tracker.start());

  chrome.tabs.onActivated.addListener(() => void tracker.reconcile());
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.url !== undefined) void tracker.reconcile();
  });
  chrome.tabs.onRemoved.addListener(() => void tracker.reconcile());

  chrome.windows.onFocusChanged.addListener(
    (windowId) => void tracker.setFocused(windowId !== chrome.windows.WINDOW_ID_NONE),
  );
  chrome.idle.onStateChanged.addListener((state) => void tracker.setPresence(state));

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ENFORCE_ALARM || alarm.name === HEARTBEAT_ALARM) void tracker.reconcile();
  });

  chrome.action.onClicked.addListener(() => void chrome.runtime.openOptionsPage());

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    void handleMessage(tracker, message).then(sendResponse);
    return true;
  });

  // The worker can be restarted at any moment; pick tracking back up straight away.
  void tracker.reconcile();
  return tracker;
}

registerBackground();
