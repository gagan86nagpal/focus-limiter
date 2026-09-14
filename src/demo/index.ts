/**
 * Entry point for the public demo at the project's GitHub Pages site.
 *
 * This is the extension's own dashboard, not a mock-up of it. The only substitution is the
 * transport: `sendMessage` normally hands a message to the service worker over
 * `chrome.runtime`, and here it calls the real `handleMessage` against a real tracker running
 * on a faked Chrome. Creating a rule therefore exercises the same validation, the same
 * 10-rule cap and the same reconcile the installed extension would.
 */
import { handleMessage } from '../background/handlers';
import { createTracker } from '../background/tracker';
import type { Message, ResponseFor } from '../shared/messages';
import { setupThemeToggle } from '../shared/theme';
import { createActivityPanel } from '../dashboard/activity';
import { createDashboard } from '../dashboard/app';
import { setupTabs } from '../dashboard/tabs';
import { installChromeStub } from './chrome-stub';
import { demoNow, demoSeed } from './fixtures';

export async function startDemo(root: Document = document, now: () => number = demoNow): Promise<void> {
  const stub = installChromeStub();
  await stub.storage.local.set(demoSeed(now()));

  const tracker = createTracker({ now });
  const send = <M extends Message>(message: M): Promise<ResponseFor<M>> =>
    handleMessage(tracker, message) as Promise<ResponseFor<M>>;

  setupThemeToggle(root);
  const dashboard = createDashboard(root, { send, now });
  const activity = createActivityPanel(root, {
    send,
    now,
    onRulesChanged: () => void dashboard.refresh(),
  });
  setupTabs(root, (id) => {
    if (id === 'activity') void activity.load();
  });
  dashboard.start();
}

void startDemo();
