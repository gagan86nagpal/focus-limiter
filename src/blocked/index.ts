import { sendMessage } from '../shared/messages';
import { setupThemeToggle } from '../shared/theme';
import { createBlockedPage } from './app';

setupThemeToggle(document);
void createBlockedPage(document, {
  send: sendMessage,
  navigate: (url) => window.location.assign(url),
  search: window.location.search,
  subscribe: (onChange) => {
    chrome.storage.onChanged.addListener((_changes, areaName) => {
      if (areaName === 'local') onChange();
    });
  },
}).load();
