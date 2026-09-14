import { sendMessage } from '../shared/messages';
import { setupThemeToggle } from '../shared/theme';
import { createActivityPanel } from './activity';
import { createDashboard } from './app';
import { setupTabs } from './tabs';

setupThemeToggle(document);

const dashboard = createDashboard(document, { send: sendMessage, now: Date.now });
const activity = createActivityPanel(document, {
  send: sendMessage,
  now: Date.now,
  onRulesChanged: () => void dashboard.refresh(),
});

// Activity is fetched when its tab is opened, so the rules tab never pays for the day's history.
setupTabs(document, (id) => {
  if (id === 'activity') void activity.load();
});

dashboard.start();
