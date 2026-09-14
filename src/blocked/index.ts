import { sendMessage } from '../shared/messages';
import { createBlockedPage } from './app';

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
