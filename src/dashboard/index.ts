import { sendMessage } from '../shared/messages';
import { createDashboard } from './app';

createDashboard(document, { send: sendMessage, now: Date.now }).start();
