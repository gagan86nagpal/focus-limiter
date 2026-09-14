import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPageBody } from '../../helpers/dom';
import { installChromeMock } from '../../helpers/chrome-mock';
import { DASHBOARD_PAGE, TEXT, createBlockedPage, type BlockedDeps } from '../../../src/blocked/app';
import { MAX_LIMIT_MINUTES } from '../../../src/shared/rules';
import type { RuleView } from '../../../src/shared/types';
import type { Message, ResponseFor } from '../../../src/shared/messages';

const ORIGINAL = 'https://x.com/home';
const ruleView = (over: Partial<RuleView> = {}): RuleView => ({
  id: 'r1',
  pattern: 'x\\.com',
  limitMinutes: 5,
  createdAt: 0,
  usedSeconds: 300,
  limitReached: true,
  ...over,
});

interface Harness {
  send: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
  page: ReturnType<typeof createBlockedPage>;
}

function setup(
  options: { rule?: RuleView | null; url?: string; ruleId?: string } = {},
): Harness {
  installChromeMock();
  loadPageBody('blocked.html');
  const rule = options.rule === undefined ? ruleView() : options.rule;
  const ruleId = options.ruleId ?? 'r1';
  const url = options.url ?? ORIGINAL;
  const send = vi.fn(async (message: Message) => {
    switch (message.type) {
      case 'getState':
        return { rules: rule === null ? [] : [rule], maxRules: 10 } as ResponseFor<typeof message>;
      case 'extendLimit': {
        if (rule === null) return { ok: false, error: 'gone' } as ResponseFor<typeof message>;
        const extended = {
          ...rule,
          limitMinutes: Math.min(MAX_LIMIT_MINUTES, rule.limitMinutes + message.minutes),
          limitReached: false,
        };
        return { ok: true, rule: extended } as ResponseFor<typeof message>;
      }
      default:
        return { ok: true } as never;
    }
  });
  const navigate = vi.fn();
  const deps: BlockedDeps = {
    send: send as unknown as BlockedDeps['send'],
    navigate,
    search: `?rule=${ruleId}&url=${encodeURIComponent(url)}`,
  };
  const page = createBlockedPage(document, deps);
  return { send, navigate, page };
}

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

describe('blocked page', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('throws a clear error when a required element is missing', () => {
    installChromeMock();
    loadPageBody('blocked.html');
    document.getElementById('continue')?.remove();
    const send = vi.fn();
    const navigate = vi.fn();
    expect(() =>
      createBlockedPage(document, {
        send: send as unknown as BlockedDeps['send'],
        navigate,
        search: '',
      }),
    ).toThrow('Missing element');
  });

  it('shows the reached state with the rule, usage, and limit', async () => {
    const h = setup();
    await h.page.load();
    expect(byId('title').textContent).toBe(TEXT.reachedTitle);
    expect(byId('blocked-pattern').textContent).toBe('x\\.com');
    expect(byId('used').textContent).toBe('5m 00s');
    expect(byId('blocked-limit').textContent).toBe('5m');
    expect(byId('message').textContent).toBe(TEXT.reachedMessage);
    expect(byId<HTMLButtonElement>('continue').disabled).toBe(true);
    expect(byId('hint').textContent).toBe(TEXT.reachedHint);
  });

  it('enables Continue and shows remaining time when under the limit', async () => {
    const h = setup({ rule: ruleView({ usedSeconds: 120, limitReached: false }) });
    await h.page.load();
    expect(byId<HTMLButtonElement>('continue').disabled).toBe(false);
    expect(byId('message').textContent).toBe(TEXT.timeLeft('3m 00s'));
  });

  it('shows the missing state when the rule no longer exists', async () => {
    const h = setup({ rule: null });
    await h.page.load();
    expect(byId('title').textContent).toBe(TEXT.missingTitle);
    expect(byId('usage').hidden).toBe(true);
    expect(byId('extend').hidden).toBe(true);
    expect(byId<HTMLButtonElement>('continue').disabled).toBe(false);
  });

  it('shows an error state when the background cannot be reached', async () => {
    const h = setup();
    h.send.mockRejectedValueOnce(new Error('offline'));
    await h.page.load();
    expect(byId('title').textContent).toBe(TEXT.errorTitle);
    expect(byId('message').textContent).toBe(TEXT.errorMessage);
    expect(byId<HTMLButtonElement>('continue').disabled).toBe(false);
  });

  it('extends the limit and then allows continuing', async () => {
    const h = setup();
    await h.page.load();
    byId('extend-5').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.send).toHaveBeenCalledWith({ type: 'extendLimit', id: 'r1', minutes: 5 });
    expect(byId('title').textContent).toBe(TEXT.extendedTitle);
    expect(byId('blocked-limit').textContent).toBe('10m');
    expect(byId<HTMLButtonElement>('continue').disabled).toBe(false);
  });

  it('extends by ten minutes', async () => {
    const h = setup();
    await h.page.load();
    byId('extend-10').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.send).toHaveBeenCalledWith({ type: 'extendLimit', id: 'r1', minutes: 10 });
    expect(byId('blocked-limit').textContent).toBe('15m');
  });

  it('extends by a custom whole number of minutes', async () => {
    const h = setup();
    await h.page.load();
    byId<HTMLInputElement>('custom-minutes').value = '2';
    byId<HTMLFormElement>('extend-custom').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(h.send).toHaveBeenCalledWith({ type: 'extendLimit', id: 'r1', minutes: 2 });
    expect(byId('blocked-limit').textContent).toBe('7m');
    expect(byId<HTMLInputElement>('custom-minutes').value).toBe('');
  });

  it.each(['1.5', '0', String(MAX_LIMIT_MINUTES)])(
    'rejects invalid custom minutes: %s',
    async (value) => {
      const h = setup();
      await h.page.load();
      const input = byId<HTMLInputElement>('custom-minutes');
      input.value = value;
      byId<HTMLFormElement>('extend-custom').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      expect(h.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'extendLimit' }));
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(byId('custom-minutes-error').textContent).toBe(
        TEXT.customMinutesError(MAX_LIMIT_MINUTES - 5),
      );

      input.dispatchEvent(new Event('input'));
      expect(input.hasAttribute('aria-invalid')).toBe(false);
      expect(byId('custom-minutes-error').textContent).toBe('');
    },
  );

  it('does not submit a custom extension after the rule disappears', async () => {
    const h = setup({ rule: null });
    await h.page.load();
    byId<HTMLInputElement>('custom-minutes').value = '1';
    byId<HTMLFormElement>('extend-custom').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    expect(h.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'extendLimit' }));
  });

  it('disables extend buttons and hints when at the maximum limit', async () => {
    const h = setup({ rule: ruleView({ limitMinutes: MAX_LIMIT_MINUTES, usedSeconds: 60, limitReached: false }) });
    await h.page.load();
    expect(byId<HTMLButtonElement>('extend-5').disabled).toBe(true);
    expect(byId<HTMLInputElement>('custom-minutes').disabled).toBe(true);
    expect(byId<HTMLButtonElement>('extend-custom-submit').disabled).toBe(true);
    expect(byId('hint').textContent).toBe(TEXT.maxHint);
  });

  it('shows the max hint on a reached rule already at the maximum', async () => {
    const h = setup({
      rule: ruleView({ limitMinutes: MAX_LIMIT_MINUTES, usedSeconds: MAX_LIMIT_MINUTES * 60, limitReached: true }),
    });
    await h.page.load();
    expect(byId('hint').textContent).toBe(TEXT.maxHint);
  });

  it('treats a missing rule after extending as the missing state', async () => {
    const h = setup({ rule: null });
    await h.page.load();
    // The rule is gone, but the extend button is still wired; clicking reports missing.
    byId('extend-5').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(byId('title').textContent).toBe(TEXT.missingTitle);
  });

  it('re-enables extend and shows an error when extending throws', async () => {
    const h = setup();
    await h.page.load();
    h.send.mockRejectedValueOnce(new Error('offline'));
    byId('extend-5').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(byId('hint').textContent).toBe(TEXT.errorMessage);
    expect(byId<HTMLButtonElement>('extend-5').disabled).toBe(false);
  });

  it('navigates back to the original URL on Continue', async () => {
    const h = setup({ rule: ruleView({ limitReached: false, usedSeconds: 60 }) });
    await h.page.load();
    byId('continue').click();
    expect(h.navigate).toHaveBeenCalledWith(ORIGINAL);
  });

  it('falls back to the dashboard when the original URL is not trackable', async () => {
    const h = setup({ rule: ruleView({ limitReached: false, usedSeconds: 60 }), url: 'chrome://settings' });
    await h.page.load();
    byId('continue').click();
    expect(h.navigate).toHaveBeenCalledWith(DASHBOARD_PAGE);
  });

  it('recovers when the rule shows up in a later storage change', async () => {
    installChromeMock();
    loadPageBody('blocked.html');
    let rule: RuleView | null = null;
    let notify = (): void => undefined;
    const send = vi.fn(async () => ({ rules: rule === null ? [] : [rule], maxRules: 10 }));
    const page = createBlockedPage(document, {
      send: send as unknown as BlockedDeps['send'],
      navigate: vi.fn(),
      search: '?rule=r1',
      subscribe: (onChange) => {
        notify = onChange;
      },
    });

    await page.load();
    expect(byId('extend').hidden).toBe(true);

    rule = ruleView();
    notify();
    await new Promise((r) => setTimeout(r, 0));

    expect(byId('extend').hidden).toBe(false);
    expect(byId('blocked-pattern').textContent).toBe('x\\.com');
  });

  it('handles a completely empty query string', async () => {
    installChromeMock();
    loadPageBody('blocked.html');
    const send = vi.fn(async () => ({ rules: [], maxRules: 10 }));
    const navigate = vi.fn();
    const page = createBlockedPage(document, {
      send: send as unknown as BlockedDeps['send'],
      navigate,
      search: '',
    });
    await page.load();
    expect(byId('title').textContent).toBe(TEXT.missingTitle);
    byId('continue').click();
    expect(navigate).toHaveBeenCalledWith(DASHBOARD_PAGE);
  });
});
