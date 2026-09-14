/**
 * Wiring for the public demo at the project's GitHub Pages site.
 *
 * This is the extension's own dashboard and its own blocked page, not mock-ups of them. The
 * only substitution is the transport: `sendMessage` normally hands a message to the service
 * worker over `chrome.runtime`, and here it calls the real `handleMessage` against a real
 * tracker running on a faked Chrome. Creating a rule therefore exercises the same validation,
 * the same 10-rule cap and the same reconcile the installed extension would.
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
import { setupSite } from './site';

/**
 * Messages that change stored state. The extension gets change notifications from
 * `chrome.storage.onChanged`; the demo has no real storage, so the transport announces its own
 * writes and the screens re-read on the back of them.
 */
const WRITES = new Set<Message['type']>(['createRule', 'updateRule', 'deleteRule', 'extendLimit']);

export async function startDemo(root: Document = document, now: () => number = demoNow): Promise<void> {
  const stub = installChromeStub();
  await stub.storage.local.set(demoSeed(now()));

  const tracker = createTracker({ now });
  const listeners = new Set<() => void>();
  const send = async <M extends Message>(message: M): Promise<ResponseFor<M>> => {
    const response = (await handleMessage(tracker, message)) as ResponseFor<M>;
    if (WRITES.has(message.type)) for (const listener of listeners) listener();
    return response;
  };

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
  const site = setupSite(root, { send, subscribe: (listener) => listeners.add(listener) });

  // Extending the limit on the block screen has to show up on the Rules tab, and deleting the
  // YouTube rule has to leave the block screen saying so.
  listeners.add(() => void dashboard.refresh());

  dashboard.start();
  await site.blocked.load();
}
