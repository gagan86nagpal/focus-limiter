/**
 * Captures the product screenshots used in the README.
 *
 * Loads the built extension into a real Chrome, seeds a believable day of rules and browsing,
 * and photographs each user flow in dark mode. Run `npm run build` first, then:
 *
 *   npm run screenshots
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionPath = path.join(root, 'dist');
const outDir = path.join(root, 'docs/screenshots');
const viewport = { width: 1160, height: 900 };

const pad = (value) => String(value).padStart(2, '0');
const midnight = (offset = 0) => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date.getTime();
};
const dayKey = (offset = 0) => {
  const date = new Date(midnight(offset));
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** A viewing session of `minutes` starting at `hour`:`minute` on the given day. */
const visit = (host, urlPath, hour, minute, minutes, dayOffset = 0) => {
  const startedAt = midnight(dayOffset) + (hour * 60 + minute) * 60_000;
  return { url: `https://${host}${urlPath}`, host, startedAt, endedAt: startedAt + minutes * 60_000 };
};

const RULES = [
  { id: 'r1', pattern: 'youtube\\.com/shorts', limitMinutes: 15, createdAt: midnight() },
  { id: 'r2', pattern: 'news\\.ycombinator\\.com', limitMinutes: 20, createdAt: midnight() },
  { id: 'r3', pattern: 'reddit\\.com', limitMinutes: 30, createdAt: midnight() },
];

const USAGE = { date: dayKey(), seconds: { r1: 900, r2: 764, r3: 412 } };

const TODAY = [
  visit('news.ycombinator.com', '/', 8, 12, 9),
  visit('github.com', '/pulls', 8, 40, 23),
  visit('youtube.com', '/shorts/9fJx2', 9, 15, 15),
  visit('github.com', '/pulls', 9, 44, 31),
  visit('reddit.com', '/r/programming', 10, 30, 7),
  visit('news.ycombinator.com', '/', 11, 5, 4),
  visit('figma.com', '/file/design-review', 11, 20, 26),
  visit('github.com', '/notifications', 12, 10, 12),
  visit('reddit.com', '/r/programming', 13, 2, 12),
  visit('mail.google.com', '/mail/u/0', 13, 40, 18),
  visit('stackoverflow.com', '/questions/71', 14, 15, 9),
  visit('news.ycombinator.com', '/newest', 14, 48, 6),
  visit('github.com', '/pulls', 15, 10, 34),
  visit('youtube.com', '/watch', 16, 5, 14),
  visit('docs.google.com', '/document/d/1', 16, 40, 21),
  visit('reddit.com', '/r/webdev', 17, 20, 5),
];

const YESTERDAY = [
  visit('github.com', '/pulls', 9, 0, 42, -1),
  visit('news.ycombinator.com', '/', 10, 10, 18, -1),
  visit('youtube.com', '/shorts/2kQp1', 11, 0, 22, -1),
  visit('figma.com', '/file/design-review', 14, 0, 35, -1),
];

const shots = [];
async function shot(target, name) {
  const file = path.join(outDir, `${name}.png`);
  await target.screenshot({ path: file });
  shots.push(name);
  console.log(`  ${name}.png`);
}

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-limiter-shots-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: true,
  viewport,
  deviceScaleFactor: 2,
  colorScheme: 'dark',
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--no-first-run'],
});

let [worker] = context.serviceWorkers();
worker ??= await context.waitForEvent('serviceworker', { timeout: 30_000 });
const extensionId = new URL(worker.url()).host;
const dashboardUrl = `chrome-extension://${extensionId}/dashboard.html`;

await worker.evaluate(
  async ([rules, usage, activity]) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ rules, usage, activity });
  },
  [RULES, USAGE, [{ date: dayKey(), segments: TODAY }, { date: dayKey(-1), segments: YESTERDAY }]],
);

fs.mkdirSync(outDir, { recursive: true });
console.log('Capturing dark-theme product screenshots:');

const page = await context.newPage();
// Pin dark mode before the dashboard script reads the stored preference.
await page.goto(dashboardUrl);
await page.evaluate(() => localStorage.setItem('focus-limiter-theme', 'dark'));

// ----- Rules tab -----
await page.goto(dashboardUrl);
await page.waitForSelector('[data-testid="rule-card"]');
await shot(page, 'rules-dark');

await page.getByTestId('add-rule').click();
await page.getByTestId('pattern-input').fill('instagram\\.com/reels');
await page.getByTestId('test-url-input').fill('https://instagram.com/reels/abc123');
await page.getByTestId('limit-input').fill('10');
await page.waitForSelector('[data-testid="match-status"]:not(:empty)');
await shot(page, 'rule-dialog-dark');
await page.getByTestId('cancel-rule').click();

const doomed = page.getByTestId('rule-card').first();
await doomed.getByTestId('delete-rule').click();
await doomed.getByTestId('confirm-delete').waitFor();
await shot(page, 'rule-delete-dark');
await doomed.getByTestId('cancel-delete').click();

// ----- Activity tab -----
await page.getByTestId('tab-activity').click();
await page.waitForSelector('[data-testid="activity-row"]');
await shot(page, 'activity-dark');

// Hover the chart at 15:25, inside the long afternoon github.com stretch.
const chart = page.getByTestId('activity-chart');
const box = await chart.boundingBox();
await page.mouse.move(box.x + box.width * ((15 * 60 + 25) / 1440), box.y + box.height / 2);
await page.waitForSelector('[data-testid="activity-tooltip"]:not([hidden])');
await shot(page, 'activity-hover-dark');
await page.mouse.move(0, 0);

await page.getByTestId('activity-legend-item').nth(1).click();
await shot(page, 'activity-focus-dark');
await page.getByTestId('activity-legend-item').nth(1).click();

const target = page.getByTestId('activity-row').filter({ hasText: 'figma.com' });
await target.getByTestId('activity-minutes').fill('25');
await target.getByTestId('activity-block').click();
await target.getByTestId('activity-has-rule').waitFor();
await shot(page, 'activity-block-dark');

await page.getByTestId('activity-prev').click();
await page.waitForFunction(
  () => document.querySelector('[data-testid="activity-day-label"]')?.textContent === 'Yesterday',
);
await shot(page, 'activity-history-dark');

// ----- Blocked page -----
const blockedUrl =
  `chrome-extension://${extensionId}/blocked.html?rule=r1` +
  `&url=${encodeURIComponent('https://youtube.com/shorts/9fJx2')}`;
const blocked = await context.newPage();
await blocked.goto(blockedUrl);
await blocked.evaluate(() => localStorage.setItem('focus-limiter-theme', 'dark'));
await blocked.goto(blockedUrl);
await blocked.waitForSelector('[data-testid="blocked-title"]');
await shot(blocked, 'blocked-dark');

await blocked.getByTestId('extend-5').click();
await blocked.waitForSelector('[data-testid="continue"]:not([disabled])');
await shot(blocked, 'blocked-extended-dark');

await context.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
console.log(`\n${String(shots.length)} screenshots written to docs/screenshots/`);
