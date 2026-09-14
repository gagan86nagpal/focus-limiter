import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChromeStub, installChromeStub, memoryArea } from '../../../src/demo/chrome-stub';

describe('memoryArea', () => {
  it('returns only the keys that were asked for', async () => {
    const area = memoryArea();
    await area.set({ rules: [1], usage: { seconds: {} } });
    expect(await area.get(['rules'])).toEqual({ rules: [1] });
  });

  it('accepts a single key as a bare string', async () => {
    const area = memoryArea();
    await area.set({ focused: true });
    expect(await area.get('focused')).toEqual({ focused: true });
  });

  it('omits keys that were never written rather than returning undefined entries', async () => {
    const area = memoryArea();
    expect(await area.get(['missing'])).toEqual({});
  });

  it('returns everything when asked for nothing', async () => {
    const area = memoryArea();
    await area.set({ a: 1, b: 2 });
    expect(await area.get()).toEqual({ a: 1, b: 2 });
    expect(await area.get(null)).toEqual({ a: 1, b: 2 });
  });

  it('overwrites on a second write, as chrome.storage does', async () => {
    const area = memoryArea();
    await area.set({ a: 1 });
    await area.set({ a: 2 });
    expect(await area.get(['a'])).toEqual({ a: 2 });
  });

  it('empties on clear', async () => {
    const area = memoryArea();
    await area.set({ a: 1 });
    await area.clear();
    expect(await area.get()).toEqual({});
  });

  it('keeps local and session areas apart', async () => {
    const stub = createChromeStub();
    await stub.storage.local.set({ rules: ['local'] });
    await stub.storage.session.set({ session: 'other' });
    expect(await stub.storage.local.get(['session'])).toEqual({});
    expect(await stub.storage.session.get(['rules'])).toEqual({});
  });
});

describe('createChromeStub', () => {
  it('reports no active tab, so the tracker opens no session over the seeded history', async () => {
    expect(await createChromeStub().tabs.query()).toEqual([]);
  });

  it('accepts the calls the tracker makes when it has nothing to enforce', async () => {
    const stub = createChromeStub();
    await expect(stub.tabs.update()).resolves.toBeUndefined();
    await expect(stub.alarms.create()).resolves.toBeUndefined();
    await expect(stub.alarms.clear()).resolves.toBe(true);
  });

  it('resolves extension URLs to plain relative paths', () => {
    expect(createChromeStub().runtime.getURL('blocked.html?rule=r1')).toBe('blocked.html?rule=r1');
  });
});

describe('installChromeStub', () => {
  it('installs onto a given target', () => {
    const target: Record<string, unknown> = {};
    const stub = installChromeStub(target);
    expect(target['chrome']).toBe(stub);
  });

  describe('without a target', () => {
    const globals = globalThis as unknown as Record<string, unknown>;
    let original: unknown;

    beforeEach(() => {
      original = globals['chrome'];
    });

    afterEach(() => {
      globals['chrome'] = original;
    });

    it('falls back to globalThis, which is where the background modules look', () => {
      const stub = installChromeStub();
      expect(globals['chrome']).toBe(stub);
    });
  });
});
