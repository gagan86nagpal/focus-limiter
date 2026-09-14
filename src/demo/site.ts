/**
 * The demo site's own chrome: the Product demo / Install tablist, and the block screen embedded
 * in the demo panel.
 *
 * The block screen is not a picture of the blocked page. It is the blocked page, mounted on a
 * subtree and reading the same faked store as the dashboard above it, so taking five more
 * minutes there moves the limit on the Rules tab. Both are talking to the same background code.
 */
import { createBlockedPage } from '../blocked/app';
import { createTabList, type TabIds, type TabsApi } from '../dashboard/tabs';
import type { Message, ResponseFor } from '../shared/messages';

export type SitePanelId = 'demo' | 'install';

export const SITE_PANEL_IDS: TabIds<SitePanelId> = ['demo', 'install'];

/** The seeded rule that is already spent, so the block screen has something real to show. */
export const BLOCKED_RULE_ID = 'demo-youtube';
export const BLOCKED_URL = 'https://www.youtube.com/';

export const CONTINUE_NOTE = (url: string): string =>
  `Continue would hand you back to ${url}. The demo stays put so you can keep looking around.`;

function q<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (found === null) throw new Error(`Missing element: ${selector}`);
  return found;
}

export interface SiteDeps {
  send: <M extends Message>(message: M) => Promise<ResponseFor<M>>;
  /** Registers a listener for writes to the store, so the block screen can re-read it. */
  subscribe: (listener: () => void) => void;
}

export interface SiteApi {
  tabs: TabsApi<SitePanelId>;
  blocked: { load: () => Promise<void> };
}

export function setupSite(root: ParentNode, deps: SiteDeps): SiteApi {
  const nav = q<HTMLElement>(root, '.site-nav');
  const tabs = createTabList(root, SITE_PANEL_IDS, 'site-', () => {
    // The panels differ in height, so switching while scrolled deep into one would otherwise
    // drop you into the middle of the other.
    nav.scrollIntoView();
  });

  // Anchors that move between panels, so copy can point at the install steps.
  for (const link of Array.from(root.querySelectorAll<HTMLElement>('[data-demo-tab]'))) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      tabs.select(link.dataset['demoTab'] as SitePanelId);
    });
  }

  const note = q<HTMLElement>(root, '#demo-continue-note');
  const blocked = createBlockedPage(q<HTMLElement>(root, '[data-testid="demo-blocked-frame"]'), {
    send: deps.send,
    search: `?rule=${BLOCKED_RULE_ID}&url=${encodeURIComponent(BLOCKED_URL)}`,
    // Leaving the page would end the demo, so Continue explains itself instead of navigating.
    navigate: (url) => {
      note.hidden = false;
      note.textContent = CONTINUE_NOTE(url);
    },
    subscribe: deps.subscribe,
  });

  return { tabs, blocked };
}
