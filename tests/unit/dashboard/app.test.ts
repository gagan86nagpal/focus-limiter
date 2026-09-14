import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPageBody } from '../../helpers/dom';
import { installChromeMock } from '../../helpers/chrome-mock';
import {
  MATCH_TEXT,
  SAVE_FAILED_TEXT,
  UNREACHABLE_TEXT,
  createDashboard,
  type DashboardDeps,
} from '../../../src/dashboard/app';
import type { RuleView, StateView } from '../../../src/shared/types';
import type { Message, ResponseFor } from '../../../src/shared/messages';

const ruleView = (over: Partial<RuleView> = {}): RuleView => ({
  id: 'r1',
  pattern: 'x\\.com',
  limitMinutes: 5,
  createdAt: 0,
  usedSeconds: 120,
  limitReached: false,
  ...over,
});

interface Harness {
  send: ReturnType<typeof vi.fn>;
  responses: { getState: StateView };
  nowRef: { value: number };
  app: ReturnType<typeof createDashboard>;
}

function setup(initial: StateView = { rules: [], maxRules: 10 }): Harness {
  installChromeMock();
  loadPageBody('dashboard.html');
  const responses = { getState: initial };
  const nowRef = { value: 1_000_000 };
  const send = vi.fn(async (message: Message) => {
    switch (message.type) {
      case 'getState':
        return responses.getState as ResponseFor<typeof message>;
      case 'createRule':
      case 'updateRule':
        return { ok: true, rule: ruleView() } as ResponseFor<typeof message>;
      case 'deleteRule':
        return { ok: true } as ResponseFor<typeof message>;
      default:
        return { ok: true } as never;
    }
  });
  const deps: DashboardDeps = {
    send: send as unknown as DashboardDeps['send'],
    now: () => nowRef.value,
  };
  const app = createDashboard(document, deps);
  return { send, responses, nowRef, app };
}

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('dashboard rendering', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the empty state when there are no rules', async () => {
    const h = setup({ rules: [], maxRules: 10 });
    await h.app.refresh();
    expect(byId('empty-state').hidden).toBe(false);
    expect(byId('rule-count').textContent).toBe('0 of 10');
    expect(byId('last-updated').textContent).toContain('Last updated');
  });

  it('renders a rule card with usage, limit, and progress', async () => {
    const h = setup({ rules: [ruleView({ usedSeconds: 151 })], maxRules: 10 });
    await h.app.refresh();
    const card = document.querySelector('.rule-card') as HTMLElement;
    expect(card.querySelector('[data-field="pattern"]')?.textContent).toBe('x\\.com');
    expect(card.querySelector('[data-field="used"]')?.textContent).toBe('2m 31s');
    expect(card.querySelector('[data-field="limit"]')?.textContent).toBe('5m');
    const fill = card.querySelector('[data-field="progress-fill"]') as HTMLElement;
    expect(fill.style.width).toBe('50%');
    expect(byId('empty-state').hidden).toBe(true);
  });

  it('marks a reached rule and clamps the progress bar at 100%', async () => {
    const h = setup({ rules: [ruleView({ usedSeconds: 600, limitReached: true })], maxRules: 10 });
    await h.app.refresh();
    const card = document.querySelector('.rule-card') as HTMLElement;
    expect(card.classList.contains('is-reached')).toBe(true);
    expect((card.querySelector('[data-field="status"]') as HTMLElement).hidden).toBe(false);
    expect((card.querySelector('[data-field="progress-fill"]') as HTMLElement).style.width).toBe('100%');
  });

  it('disables adding and shows a notice at the rule limit', async () => {
    const rules = Array.from({ length: 10 }, (_, i) => ruleView({ id: `r${i}`, pattern: `p${i}` }));
    const h = setup({ rules, maxRules: 10 });
    await h.app.refresh();
    expect(byId<HTMLButtonElement>('add-rule').disabled).toBe(true);
    expect(byId('limit-notice').hidden).toBe(false);
  });

  it('reuses card elements across refreshes and removes deleted ones', async () => {
    const h = setup({ rules: [ruleView({ id: 'a', pattern: 'a' }), ruleView({ id: 'b', pattern: 'b' })], maxRules: 10 });
    await h.app.refresh();
    const first = document.querySelector('.rule-card');
    h.responses.getState = { rules: [ruleView({ id: 'b', pattern: 'b' })], maxRules: 10 };
    await h.app.refresh();
    expect(document.querySelectorAll('.rule-card')).toHaveLength(1);
    expect(document.querySelector('[data-field="pattern"]')?.textContent).toBe('b');
    expect(first?.isConnected).toBe(false);
  });

  it('keeps stable order when a rule is inserted at the front', async () => {
    const h = setup({ rules: [ruleView({ id: 'b', pattern: 'b' })], maxRules: 10 });
    await h.app.refresh();
    h.responses.getState = {
      rules: [ruleView({ id: 'a', pattern: 'a' }), ruleView({ id: 'b', pattern: 'b' })],
      maxRules: 10,
    };
    await h.app.refresh();
    const patterns = Array.from(document.querySelectorAll('[data-field="pattern"]')).map((el) => el.textContent);
    expect(patterns).toEqual(['a', 'b']);
  });

  it('shows an error in the footer when the background is unreachable', async () => {
    const h = setup();
    h.send.mockRejectedValueOnce(new Error('no worker'));
    await h.app.refresh();
    expect(byId('last-updated').textContent).toBe(UNREACHABLE_TEXT);
    expect(byId('last-updated').classList.contains('is-error')).toBe(true);
  });
});

describe('construction', () => {
  it('throws a clear error when a required element is missing', () => {
    installChromeMock();
    loadPageBody('dashboard.html');
    document.getElementById('add-rule')?.remove();
    const send = vi.fn();
    expect(() =>
      createDashboard(document, { send: send as unknown as DashboardDeps['send'], now: () => 0 }),
    ).toThrow('Missing element');
  });
});

describe('rule dialog', () => {
  it('opens the create dialog with default values', async () => {
    const h = setup();
    await h.app.refresh();
    byId('add-rule').click();
    expect(byId('rule-dialog').hasAttribute('open')).toBe(true);
    expect(byId('dialog-title').textContent).toBe('Create rule');
    expect(byId<HTMLInputElement>('limit').value).toBe('10');
  });

  it('opens the create dialog from the empty state button', async () => {
    const h = setup();
    await h.app.refresh();
    byId('empty-add-rule').click();
    expect(byId('rule-dialog').hasAttribute('open')).toBe(true);
  });

  it('opens the edit dialog populated from the rule', async () => {
    const h = setup({ rules: [ruleView({ pattern: 'edit\\.me', limitMinutes: 30 })], maxRules: 10 });
    await h.app.refresh();
    (document.querySelector('[data-action="edit"]') as HTMLButtonElement).click();
    expect(byId('dialog-title').textContent).toBe('Edit rule');
    expect(byId<HTMLInputElement>('pattern').value).toBe('edit\\.me');
    expect(byId<HTMLInputElement>('limit').value).toBe('30');
  });

  it('gives live match feedback for the test URL', async () => {
    const h = setup();
    await h.app.refresh();
    byId('add-rule').click();
    const pattern = byId<HTMLInputElement>('pattern');
    const testUrl = byId<HTMLInputElement>('test-url');

    pattern.value = 'shorts';
    pattern.dispatchEvent(new Event('input'));
    testUrl.value = 'https://youtube.com/shorts/x';
    testUrl.dispatchEvent(new Event('input'));
    expect(byId('match-status').textContent).toBe(MATCH_TEXT.match);

    testUrl.value = 'https://youtube.com/watch';
    testUrl.dispatchEvent(new Event('input'));
    expect(byId('match-status').textContent).toBe(MATCH_TEXT['no-match']);

    pattern.value = '(';
    pattern.dispatchEvent(new Event('input'));
    expect(byId('match-status').textContent).toBe(MATCH_TEXT.invalid);
  });

  it('validates input and shows field errors without sending', async () => {
    const h = setup();
    await h.app.refresh();
    byId('add-rule').click();
    byId<HTMLInputElement>('pattern').value = '(';
    byId('rule-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(byId('pattern-error').textContent).toBeTruthy();
    expect(h.send).toHaveBeenCalledTimes(1); // only the initial refresh
  });

  it('shows the limit field error when the limit is invalid', async () => {
    const h = setup();
    await h.app.refresh();
    byId('add-rule').click();
    byId<HTMLInputElement>('pattern').value = 'ok';
    byId<HTMLInputElement>('limit').value = '0';
    byId('rule-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(byId('limit-error').textContent).toBeTruthy();
  });

  it('creates a rule and closes the dialog on success', async () => {
    const h = setup();
    await h.app.refresh();
    byId('add-rule').click();
    byId<HTMLInputElement>('pattern').value = 'new\\.com';
    byId<HTMLInputElement>('limit').value = '12';
    byId('rule-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(h.send).toHaveBeenCalledWith({ type: 'createRule', input: { pattern: 'new\\.com', limitMinutes: 12 } });
    expect(byId('rule-dialog').hasAttribute('open')).toBe(false);
  });

  it('updates a rule when editing', async () => {
    const h = setup({ rules: [ruleView()], maxRules: 10 });
    await h.app.refresh();
    (document.querySelector('[data-action="edit"]') as HTMLButtonElement).click();
    byId<HTMLInputElement>('pattern').value = 'y\\.com';
    byId('rule-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(h.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'updateRule', id: 'r1' }));
  });

  it('surfaces a server-side field error', async () => {
    const h = setup();
    await h.app.refresh();
    h.send.mockResolvedValueOnce({ ok: false, error: 'bad', errors: { pattern: 'server says no' } });
    byId('add-rule').click();
    byId<HTMLInputElement>('pattern').value = 'ok';
    byId('rule-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(byId('pattern-error').textContent).toBe('server says no');
  });

  it('surfaces a server-side general error', async () => {
    const h = setup();
    await h.app.refresh();
    h.send.mockResolvedValueOnce({ ok: false, error: 'You can have at most 10 rules' });
    byId('add-rule').click();
    byId<HTMLInputElement>('pattern').value = 'ok';
    byId('rule-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(byId('form-error').textContent).toBe('You can have at most 10 rules');
  });

  it('shows a fallback error when the save request throws', async () => {
    const h = setup();
    await h.app.refresh();
    h.send.mockRejectedValueOnce(new Error('offline'));
    byId('add-rule').click();
    byId<HTMLInputElement>('pattern').value = 'ok';
    byId('rule-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(byId('form-error').textContent).toBe(SAVE_FAILED_TEXT);
  });

  it('clears the pattern error as the user types', async () => {
    const h = setup();
    await h.app.refresh();
    byId('add-rule').click();
    byId<HTMLInputElement>('pattern').value = '(';
    byId('rule-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(byId('pattern-error').textContent).toBeTruthy();
    const pattern = byId<HTMLInputElement>('pattern');
    pattern.value = 'ok';
    pattern.dispatchEvent(new Event('input'));
    expect(byId('pattern-error').textContent).toBe('');
  });

  it('clears the limit error as the user types', async () => {
    const h = setup();
    await h.app.refresh();
    byId('add-rule').click();
    byId<HTMLInputElement>('pattern').value = 'ok';
    byId<HTMLInputElement>('limit').value = '0';
    byId('rule-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    const limit = byId<HTMLInputElement>('limit');
    limit.value = '5';
    limit.dispatchEvent(new Event('input'));
    expect(byId('limit-error').textContent).toBe('');
  });

  it('cancels the dialog', async () => {
    const h = setup();
    await h.app.refresh();
    byId('add-rule').click();
    byId('cancel-rule').click();
    expect(byId('rule-dialog').hasAttribute('open')).toBe(false);
  });
});

describe('rule deletion', () => {
  it('asks for confirmation before deleting', async () => {
    const h = setup({ rules: [ruleView()], maxRules: 10 });
    await h.app.refresh();
    (document.querySelector('[data-action="delete"]') as HTMLButtonElement).click();
    const card = document.querySelector('.rule-card') as HTMLElement;
    expect((card.querySelector('[data-field="confirm"]') as HTMLElement).hidden).toBe(false);

    (card.querySelector('[data-action="cancel-delete"]') as HTMLButtonElement).click();
    expect((card.querySelector('[data-field="confirm"]') as HTMLElement).hidden).toBe(true);
  });

  it('deletes the rule when confirmed', async () => {
    const h = setup({ rules: [ruleView()], maxRules: 10 });
    await h.app.refresh();
    (document.querySelector('[data-action="delete"]') as HTMLButtonElement).click();
    h.responses.getState = { rules: [], maxRules: 10 };
    (document.querySelector('[data-action="confirm-delete"]') as HTMLButtonElement).click();
    await flush();
    expect(h.send).toHaveBeenCalledWith({ type: 'deleteRule', id: 'r1' });
    expect(document.querySelectorAll('.rule-card')).toHaveLength(0);
  });

  it('still refreshes when the delete request fails', async () => {
    const h = setup({ rules: [ruleView()], maxRules: 10 });
    await h.app.refresh();
    h.send.mockRejectedValueOnce(new Error('offline'));
    (document.querySelector('[data-action="delete"]') as HTMLButtonElement).click();
    (document.querySelector('[data-action="confirm-delete"]') as HTMLButtonElement).click();
    await flush();
    expect(h.send).toHaveBeenCalledWith({ type: 'deleteRule', id: 'r1' });
  });
});

describe('polling lifecycle', () => {
  it('refreshes on an interval only while the page is visible', async () => {
    vi.useFakeTimers();
    const h = setup();
    h.app.start(1000);
    await vi.advanceTimersByTimeAsync(0);
    const initial = h.send.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.send.mock.calls.length).toBe(initial + 1);

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.send.mock.calls.length).toBe(initial + 1);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.send.mock.calls.length).toBe(initial + 2);

    h.app.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.send.mock.calls.length).toBe(initial + 2);
    vi.useRealTimers();
  });

  it('does not refresh on visibilitychange while hidden', async () => {
    const h = setup();
    await h.app.refresh();
    const count = h.send.mock.calls.length;
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(h.send.mock.calls.length).toBe(count);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('stop is a no-op when never started', () => {
    const h = setup();
    expect(() => h.app.stop()).not.toThrow();
  });
});
