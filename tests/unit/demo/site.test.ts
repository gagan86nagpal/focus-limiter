import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDemoBody } from '../../helpers/dom';
import { BLOCKED_RULE_ID, BLOCKED_URL, CONTINUE_NOTE, setupSite } from '../../../src/demo/site';
import type { Message } from '../../../src/shared/messages';

const RULE = {
  id: BLOCKED_RULE_ID,
  pattern: 'youtube\\.com',
  limitMinutes: 25,
  usedSeconds: 1500,
  limitReached: true,
};

function click(element: Element | null): void {
  element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

describe('demo site', () => {
  beforeEach(() => {
    loadDemoBody();
  });

  function mount(send = vi.fn(async () => ({ rules: [RULE], maxRules: 10 }))) {
    const subscribe = vi.fn();
    const site = setupSite(document, {
      send: send as unknown as <M extends Message>(message: M) => Promise<never>,
      subscribe,
    });
    return { site, send, subscribe };
  }

  it('opens on the product demo, with the install panel held back', () => {
    mount();

    expect(document.getElementById('site-tab-demo')?.getAttribute('aria-selected')).toBe('true');
    expect((document.getElementById('site-panel-demo') as HTMLElement).hidden).toBe(false);
    expect((document.getElementById('site-panel-install') as HTMLElement).hidden).toBe(true);
  });

  it('swaps the panels when the install tab is chosen', () => {
    const { site } = mount();

    click(document.getElementById('site-tab-install'));

    expect(site.tabs.current()).toBe('install');
    expect((document.getElementById('site-panel-demo') as HTMLElement).hidden).toBe(true);
    expect((document.getElementById('site-panel-install') as HTMLElement).hidden).toBe(false);
    expect(document.querySelector('[data-testid="install-clone"]')?.textContent).toContain(
      'git clone',
    );
  });

  it('brings the nav back into view, so a tab change does not land you mid-page', () => {
    const nav = document.querySelector('.site-nav') as HTMLElement;
    const scrollIntoView = vi.fn();
    nav.scrollIntoView = scrollIntoView;

    mount();
    // Once for the initial selection.
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    click(document.getElementById('site-tab-install'));
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('sends the banner link to the install panel instead of following the anchor', () => {
    const { site } = mount();
    const link = document.querySelector('[data-testid="demo-banner-link"]') as HTMLAnchorElement;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });

    link.dispatchEvent(event);

    expect(site.tabs.current()).toBe('install');
    expect(event.defaultPrevented).toBe(true);
  });

  it('mounts the extension\u2019s own block screen on the spent rule', async () => {
    const { site, send } = mount();

    await site.blocked.load();

    expect(send).toHaveBeenCalledWith({ type: 'getState' });
    expect(document.querySelector('[data-testid="blocked-title"]')?.textContent).toBe(
      'Daily limit reached',
    );
    expect(document.querySelector('[data-testid="blocked-pattern"]')?.textContent).toBe(
      'youtube\\.com',
    );
    expect(document.querySelector('[data-testid="blocked-used"]')?.textContent).toBe('25m 00s');
    expect(document.querySelector('[data-testid="blocked-limit"]')?.textContent).toBe('25m');
  });

  it('scopes the block screen to its own frame, leaving the rule dialog alone', async () => {
    const { site } = mount();

    await site.blocked.load();

    // Both screens are on the page, and #pattern belongs to the dashboard's dialog.
    const dialogPattern = document.getElementById('pattern') as HTMLInputElement;
    expect(dialogPattern.tagName).toBe('INPUT');
    expect(dialogPattern.value).toBe('');
    expect(document.getElementById('blocked-pattern')?.textContent).toBe('youtube\\.com');
  });

  it('explains Continue rather than navigating away from the demo', async () => {
    const notReached = { ...RULE, usedSeconds: 60, limitReached: false };
    const { site } = mount(vi.fn(async () => ({ rules: [notReached], maxRules: 10 })));
    await site.blocked.load();

    const note = document.querySelector('[data-testid="demo-continue-note"]') as HTMLElement;
    expect(note.hidden).toBe(true);

    click(document.querySelector('[data-testid="continue"]'));

    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe(CONTINUE_NOTE(BLOCKED_URL));
  });

  it('re-reads the store when told it changed', async () => {
    const { site, subscribe } = mount();
    await site.blocked.load();
    expect(document.querySelector('[data-testid="blocked-pattern"]')?.textContent).toBe(
      'youtube\\.com',
    );

    // The rule is gone; the block screen should say so rather than keep showing a stale limit.
    const listener = subscribe.mock.calls[0]?.[0] as () => void;
    site.blocked.load = vi.fn();
    listener();

    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('fails loudly when the shell is missing the block screen frame', () => {
    document.querySelector('[data-testid="demo-blocked-frame"]')?.remove();

    expect(() => mount()).toThrow('Missing element: [data-testid="demo-blocked-frame"]');
  });
});
