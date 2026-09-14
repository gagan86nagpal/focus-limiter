import { afterEach, vi } from 'vitest';

// crypto.randomUUID exists in Node 22, but guarantee it for the jsdom env.
if (typeof globalThis.crypto?.randomUUID !== 'function') {
  let counter = 0;
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: () => `uuid-${++counter}` },
    configurable: true,
  });
}

// jsdom has no layout, so it ships no scrollIntoView; the demo site calls it on tab changes.
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoView() {
    return undefined;
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
