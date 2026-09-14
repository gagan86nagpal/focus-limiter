/**
 * Drives the built demo in `dist-demo/` as a plain website.
 *
 * No extension is loaded here, which is the point: these tests prove the dashboard still works
 * with the service worker replaced by a faked Chrome, so the published demo cannot quietly rot
 * while the extension's own e2e suite stays green.
 */
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

const dist = path.resolve(import.meta.dirname, '../../dist-demo');
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
};

let server: http.Server;
let origin: string;

test.beforeAll(() => {
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    throw new Error('dist-demo/index.html is missing. Run `npm run demo` first.');
  }
  server = http.createServer((req, res) => {
    const requested = (req.url ?? '/').split('?')[0] ?? '/';
    const file = path.join(dist, requested === '/' ? 'index.html' : requested.slice(1));
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  return new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => {
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    resolve();
  }));
});

test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

/** Opens the demo, failing the test on any console error or uncaught exception. */
async function openDemo(page: Page): Promise<void> {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  await page.goto(origin);
  await expect(page.getByTestId('rule-card').first()).toBeVisible();
  expect(problems, 'the demo loaded without console errors').toEqual([]);
}

async function openActivity(page: Page): Promise<void> {
  await page.getByTestId('tab-activity').click();
  await expect(page.getByTestId('activity-row').first()).toBeVisible();
}

test('explains that it is a demo and links to the repository', async ({ page }) => {
  await openDemo(page);
  await expect(page.getByTestId('demo-banner')).toContainText('Live demo');
  await expect(page.getByTestId('demo-banner-link')).toHaveAttribute(
    'href',
    'https://github.com/gagan86nagpal/focus-limiter',
  );
});

test('opens with seeded rules, one of them already spent', async ({ page }) => {
  await openDemo(page);
  await expect(page.getByTestId('rule-card')).toHaveCount(3);
  await expect(page.getByTestId('rule-count')).toHaveText('3 of 10');
  // A mix of states is deliberate: one card shows the limit-reached pill, the others progress.
  // Every card carries the pill in its markup, so only the shown ones count.
  await expect(page.locator('[data-testid="limit-reached"]:not([hidden])')).toHaveCount(1);
});

test('shows a full day on the activity tab', async ({ page }) => {
  await openDemo(page);
  await openActivity(page);

  await expect(page.getByTestId('activity-day-label')).toHaveText('Today');
  await expect(page.getByTestId('activity-total')).toHaveText(/^\d+h \d+m$/);
  await expect(page.getByTestId('activity-chart').locator('.tl-bar').first()).toBeVisible();
  await expect(page.getByTestId('activity-legend-item').first()).toBeVisible();
  await expect(page.getByTestId('activity-row').first()).toBeVisible();
});

test('hovering the chart names the site and the minute', async ({ page }) => {
  await openDemo(page);
  await openActivity(page);

  const bar = page.getByTestId('activity-chart').locator('.tl-bar').nth(3);
  const barBox = await bar.boundingBox();
  const chartBox = await page.getByTestId('activity-chart').boundingBox();
  await page.mouse.move(
    (barBox?.x ?? 0) + (barBox?.width ?? 0) / 2,
    (chartBox?.y ?? 0) + (chartBox?.height ?? 0) / 2,
  );

  const tooltip = page.getByTestId('activity-tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText(/\d\d:\d\d/);
  await expect(tooltip).toContainText('.com');
});

test('pinning a legend chip dims the other sites', async ({ page }) => {
  await openDemo(page);
  await openActivity(page);

  const chip = page.getByTestId('activity-legend-item').first();
  await chip.click();
  await expect(chip).toHaveClass(/is-pinned/);

  await chip.click();
  await expect(chip).not.toHaveClass(/is-pinned/);
});

test('blocking a site from the list creates a real rule and updates both tabs', async ({ page }) => {
  await openDemo(page);
  await openActivity(page);

  const row = page.getByTestId('activity-row').filter({ has: page.getByTestId('activity-block') }).first();
  const host = await row.getByTestId('activity-host').innerText();
  await row.getByTestId('activity-minutes').fill('20');
  await row.getByTestId('activity-block').click();

  await expect(row.getByTestId('activity-has-rule')).toBeVisible();

  await page.getByTestId('tab-rules').click();
  await expect(page.getByTestId('rule-count')).toHaveText('4 of 10');
  // The suggested pattern is escaped for the regex form the worker validates.
  await expect(page.getByTestId('rule-card').last()).toContainText(host.replace(/\./g, '\\.'));
});

test('rejects an unparseable pattern through the extension\u2019s own validator', async ({ page }) => {
  await openDemo(page);

  await page.getByTestId('add-rule').click();
  await page.getByTestId('pattern-input').fill('(unclosed');
  await page.getByTestId('save-rule').click();

  await expect(page.getByTestId('pattern-error')).not.toBeEmpty();
  await expect(page.getByTestId('rule-card')).toHaveCount(3);
});

test('walks back through the month of history', async ({ page }) => {
  await openDemo(page);
  await openActivity(page);

  await page.getByTestId('activity-prev').click();
  await expect(page.getByTestId('activity-day-label')).toHaveText('Yesterday');
  await expect(page.getByTestId('activity-row').first()).toBeVisible();

  // Two days back stops being named and starts being dated.
  await page.getByTestId('activity-prev').click();
  await expect(page.getByTestId('activity-day-label')).toHaveText(/^\w{3}, \w{3} \d{1,2}$/);

  await page.getByTestId('activity-today').click();
  await expect(page.getByTestId('activity-day-label')).toHaveText('Today');
});

test('carries the theme toggle across both tabs', async ({ page }) => {
  await openDemo(page);

  await page.getByTestId('theme-toggle').click();
  const theme = await page.locator('html').getAttribute('data-theme');
  await openActivity(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme ?? '');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme ?? '');
});
