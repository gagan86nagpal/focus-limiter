import { vi } from 'vitest';

/** A listener registry that lets tests fire Chrome events synchronously. */
export interface FakeEvent<F extends (...args: never[]) => void> {
  addListener: (fn: F) => void;
  removeListener: (fn: F) => void;
  hasListener: (fn: F) => boolean;
  emit: (...args: Parameters<F>) => void;
  listeners: F[];
}

function fakeEvent<F extends (...args: never[]) => void>(): FakeEvent<F> {
  const listeners: F[] = [];
  return {
    listeners,
    addListener: (fn) => listeners.push(fn),
    removeListener: (fn) => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    hasListener: (fn) => listeners.includes(fn),
    emit: (...args) => listeners.slice().forEach((fn) => fn(...args)),
  };
}

/** An in-memory chrome.storage.local / .session area. */
function fakeStorageArea() {
  const data = new Map<string, unknown>();
  return {
    _data: data,
    get: vi.fn(async (keys?: string[] | string | null) => {
      if (keys === undefined || keys === null) return Object.fromEntries(data);
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const key of list) {
        if (data.has(key)) out[key] = data.get(key);
      }
      return out;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) data.set(key, value);
    }),
    remove: vi.fn(async (keys: string[] | string) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) data.delete(key);
    }),
    clear: vi.fn(async () => data.clear()),
  };
}

export type ChromeMock = ReturnType<typeof createChromeMock>;

export function createChromeMock() {
  const local = fakeStorageArea();
  const session = fakeStorageArea();
  const tabs: chrome.tabs.Tab[] = [];

  const chromeMock = {
    runtime: {
      id: 'test-extension-id',
      getURL: (path: string) => `chrome-extension://test-extension-id/${path}`,
      openOptionsPage: vi.fn(async () => undefined),
      lastError: undefined as chrome.runtime.LastError | undefined,
      sendMessage: vi.fn(),
      onInstalled: fakeEvent<() => void>(),
      onStartup: fakeEvent<() => void>(),
      onMessage: fakeEvent<
        (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean | void
      >(),
    },
    storage: {
      local,
      session,
      onChanged: fakeEvent<(changes: Record<string, unknown>, areaName: string) => void>(),
    },
    tabs: {
      _tabs: tabs,
      query: vi.fn(async (info: chrome.tabs.QueryInfo) => {
        if (info.active === true) return tabs.filter((tab) => tab.active);
        return tabs.slice();
      }),
      update: vi.fn(async (_tabId: number, props: chrome.tabs.UpdateProperties) => {
        void props;
        return undefined;
      }),
      onActivated: fakeEvent<(info: chrome.tabs.OnActivatedInfo) => void>(),
      onUpdated: fakeEvent<(tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo) => void>(),
      onRemoved: fakeEvent<(tabId: number) => void>(),
    },
    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged: fakeEvent<(windowId: number) => void>(),
    },
    idle: {
      onStateChanged: fakeEvent<(state: `${chrome.idle.IdleState}`) => void>(),
    },
    alarms: {
      create: vi.fn(async () => undefined),
      clear: vi.fn(async () => true),
      onAlarm: fakeEvent<(alarm: chrome.alarms.Alarm) => void>(),
    },
    action: {
      onClicked: fakeEvent<() => void>(),
    },
  };

  return chromeMock;
}

/** Installs a fresh chrome mock on globalThis and returns it. */
export function installChromeMock(): ChromeMock {
  const mock = createChromeMock();
  (globalThis as unknown as { chrome: unknown }).chrome = mock;
  return mock;
}

export function makeTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: 1,
    active: true,
    url: 'https://example.com/',
    index: 0,
    pinned: false,
    highlighted: true,
    windowId: 1,
    incognito: false,
    selected: true,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    frozen: false,
    ...overrides,
  } as chrome.tabs.Tab;
}
