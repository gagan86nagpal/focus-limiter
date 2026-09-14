import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDemoBody } from '../../helpers/dom';

describe('demo entry', () => {
  const globals = globalThis as unknown as Record<string, unknown>;
  let originalChrome: unknown;

  beforeEach(() => {
    originalChrome = globals['chrome'];
    loadDemoBody();
  });

  afterEach(() => {
    globals['chrome'] = originalChrome;
  });

  it('starts the demo on import, with no service worker to wait for', async () => {
    vi.resetModules();
    await import('../../../src/demo/index');

    await vi.waitFor(() => {
      expect(document.querySelectorAll('[data-testid="rule-card"]').length).toBe(3);
    });
    // The block screen is up too, which is the half that needs the faked storage.
    expect(document.querySelector('[data-testid="blocked-pattern"]')?.textContent).toBe(
      'youtube\\.com',
    );
  });
});
