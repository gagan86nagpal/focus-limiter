import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPageBody } from '../../helpers/dom';
import { demoNow } from '../../../src/demo/fixtures';
import { dateKey } from '../../../src/shared/time';

const NOON = new Date('2026-09-14T12:00:00').getTime();

describe('demo entry', () => {
  const globals = globalThis as unknown as Record<string, unknown>;
  let originalChrome: unknown;

  beforeEach(() => {
    originalChrome = globals['chrome'];
    loadPageBody('dashboard.html');
  });

  afterEach(() => {
    globals['chrome'] = originalChrome;
  });

  it('renders the seeded rules without a service worker anywhere', async () => {
    const { startDemo } = await import('../../../src/demo/index');
    await startDemo(document, () => NOON);
    await vi.waitFor(() => {
      expect(document.querySelectorAll('[data-testid="rule-card"]').length).toBe(3);
    });
    expect(document.getElementById('rule-count')?.textContent).toBe('3 of 10');
  });

  it('serves the activity tab from the same seeded history', async () => {
    const { startDemo } = await import('../../../src/demo/index');
    await startDemo(document, () => NOON);

    document.getElementById('tab-activity')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await vi.waitFor(() => {
      expect(document.querySelectorAll('[data-testid="activity-row"]').length).toBeGreaterThan(0);
    });
    expect((document.getElementById('activity-date') as HTMLInputElement).value).toBe(dateKey(NOON));
  });

  it('runs a created rule through the extension\u2019s own validation', async () => {
    const { startDemo } = await import('../../../src/demo/index');
    await startDemo(document, () => NOON);
    await vi.waitFor(() => {
      expect(document.querySelectorAll('[data-testid="rule-card"]').length).toBe(3);
    });

    document.getElementById('add-rule')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    (document.getElementById('pattern') as HTMLInputElement).value = '(unclosed';
    (document.getElementById('limit') as HTMLInputElement).value = '10';
    document.getElementById('rule-form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      expect(document.getElementById('pattern-error')?.textContent ?? '').not.toBe('');
    });
    // Rejected by the real validator, so the list is untouched.
    expect(document.querySelectorAll('[data-testid="rule-card"]').length).toBe(3);
  });

  it('adds a rule to the seeded three when the pattern is sound', async () => {
    const { startDemo } = await import('../../../src/demo/index');
    await startDemo(document, () => NOON);
    await vi.waitFor(() => {
      expect(document.querySelectorAll('[data-testid="rule-card"]').length).toBe(3);
    });

    document.getElementById('add-rule')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    (document.getElementById('pattern') as HTMLInputElement).value = 'instagram\\.com';
    (document.getElementById('limit') as HTMLInputElement).value = '10';
    document.getElementById('rule-form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      expect(document.querySelectorAll('[data-testid="rule-card"]').length).toBe(4);
    });
  });

  it('refreshes the rules tab when a site is blocked from the activity list', async () => {
    const { startDemo } = await import('../../../src/demo/index');
    await startDemo(document, () => NOON);
    await vi.waitFor(() => {
      expect(document.querySelectorAll('[data-testid="rule-card"]').length).toBe(3);
    });

    document.getElementById('tab-activity')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => {
      expect(document.querySelectorAll('[data-testid="activity-row"]').length).toBeGreaterThan(0);
    });

    const row = Array.from(document.querySelectorAll('[data-testid="activity-row"]')).find(
      (candidate) => candidate.querySelector('[data-testid="activity-block"]') !== null,
    );
    row
      ?.querySelector('[data-testid="activity-block"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // The panel reports back so the rules tab is already up to date behind it.
    await vi.waitFor(() => {
      expect(document.querySelectorAll('[data-testid="rule-card"]').length).toBe(4);
    });
  });

  it('boots on import, taking the document and the demo clock by default', async () => {
    vi.resetModules();
    await import('../../../src/demo/index');
    await vi.waitFor(() => {
      expect(document.querySelectorAll('[data-testid="rule-card"]').length).toBe(3);
    });
    // The date the panel offers comes from the demo clock, not from a frozen past day.
    document.getElementById('tab-activity')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => {
      expect((document.getElementById('activity-date') as HTMLInputElement).value).toBe(
        dateKey(demoNow()),
      );
    });
  });
});
