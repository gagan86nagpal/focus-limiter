import { sendMessage } from '../shared/messages';
import { setupThemeToggle } from '../shared/theme';
import { createDashboard } from './app';

setupThemeToggle(document);
createDashboard(document, { send: sendMessage, now: Date.now }).start();
