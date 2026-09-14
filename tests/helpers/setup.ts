import { afterEach, vi } from 'vitest';

// crypto.randomUUID exists in Node 22, but guarantee it for the jsdom env.
if (typeof globalThis.crypto?.randomUUID !== 'function') {
  let counter = 0;
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: () => `uuid-${++counter}` },
    configurable: true,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
