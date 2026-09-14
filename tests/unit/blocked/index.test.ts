import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPageBody } from '../../helpers/dom';
import { installChromeMock, type ChromeMock } from '../../helpers/chrome-mock';

describe('blocked entry', () => {
  let chromeMock: ChromeMock;

  beforeEach(() => {
    chromeMock = installChromeMock();
    loadPageBody('blocked.html');
    chromeMock.runtime.sendMessage = vi.fn(async () => ({
      rules: [{ id: 'r1', pattern: 'x', limitMinutes: 5, createdAt: 0, usedSeconds: 60, limitReached: false }],
      maxRules: 10,
    }));
    // The entry reads window.location.search; jsdom provides a default of ''.
    Object.defineProperty(window, 'location', {
      value: { search: '?rule=r1&url=https%3A%2F%2Fx.com', assign: vi.fn() },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('boots the blocked page and renders the blocking rule', async () => {
    vi.resetModules();
    await import('../../../src/blocked/index');
    await new Promise((r) => setTimeout(r, 0));
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({ type: 'getState' });
    expect(document.getElementById('blocked-pattern')?.textContent).toBe('x');
  });

  it('reloads on local storage changes and ignores other areas', async () => {
    vi.resetModules();
    await import('../../../src/blocked/index');
    await new Promise((r) => setTimeout(r, 0));
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledTimes(1);

    chromeMock.storage.onChanged.emit({ usage: {} }, 'session');
    await new Promise((r) => setTimeout(r, 0));
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledTimes(1);

    chromeMock.storage.onChanged.emit({ usage: {} }, 'local');
    await new Promise((r) => setTimeout(r, 0));
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('navigates using window.location.assign on continue', async () => {
    vi.resetModules();
    await import('../../../src/blocked/index');
    await new Promise((r) => setTimeout(r, 0));
    (document.getElementById('continue') as HTMLButtonElement).click();
    expect((window.location as unknown as { assign: ReturnType<typeof vi.fn> }).assign).toHaveBeenCalledWith(
      'https://x.com',
    );
  });
});
