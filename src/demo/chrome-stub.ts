/**
 * Just enough of the `chrome` API for the extension's own background code to run in a page.
 *
 * The demo deliberately fakes Chrome rather than faking the backend. Every message the
 * dashboard sends goes through the real `handleMessage` and the real tracker, so the demo
 * cannot drift from the extension's behaviour: validation, the 10-rule cap, the daily reset
 * and the activity view are all the shipped code paths. Only the browser underneath is
 * invented.
 *
 * `tabs.query` returns nothing on purpose. With no active tab the tracker opens no session,
 * so the seeded history stays exactly as laid out instead of growing while the page is open,
 * and nothing can be redirected to a blocked page that does not exist here.
 */

interface StoredItems {
  [key: string]: unknown;
}

/** A promise-based, in-memory stand-in for one `chrome.storage` area. */
export function memoryArea() {
  const data = new Map<string, unknown>();
  return {
    get: async (keys?: string[] | string | null): Promise<StoredItems> => {
      if (keys === undefined || keys === null) return Object.fromEntries(data);
      const wanted = Array.isArray(keys) ? keys : [keys];
      const out: StoredItems = {};
      for (const key of wanted) {
        if (data.has(key)) out[key] = data.get(key);
      }
      return out;
    },
    set: async (items: StoredItems): Promise<void> => {
      for (const [key, value] of Object.entries(items)) data.set(key, value);
    },
    clear: async (): Promise<void> => {
      data.clear();
    },
  };
}

export type ChromeStub = ReturnType<typeof createChromeStub>;

export function createChromeStub() {
  return {
    runtime: {
      getURL: (path: string) => path,
    },
    storage: {
      local: memoryArea(),
      session: memoryArea(),
    },
    tabs: {
      query: async () => [],
      update: async () => undefined,
    },
    alarms: {
      create: async () => undefined,
      clear: async () => true,
    },
  };
}

/** Installs the stub as the global `chrome`, which the background modules read on demand. */
export function installChromeStub(target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): ChromeStub {
  const stub = createChromeStub();
  target['chrome'] = stub;
  return stub;
}
