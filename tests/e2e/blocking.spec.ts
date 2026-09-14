import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';
import { clearStorage, expect, seed, test } from './fixtures';

let server: http.Server;
let origin: string;

test.beforeAll(async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>Time sink</title><h1>Time sink</h1>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const today = () => new Date().toISOString().slice(0, 10);
const blocked = (id: string, ruleId: string, url: string) =>
  `chrome-extension://${id}/blocked.html?rule=${ruleId}&url=${encodeURIComponent(url)}`;

test.beforeEach(async ({ serviceWorker }) => {
  await clearStorage(serviceWorker);
});

async function seedReachedRule(worker: Parameters<typeof seed>[0], pattern: string): Promise<void> {
  await seed(worker, {
    rules: [{ id: 'r1', pattern, limitMinutes: 5, createdAt: Date.now() }],
    usage: { date: today(), seconds: { r1: 300 } },
  });
}

test('the blocked page explains why the user was redirected', async ({ context, extensionId, serviceWorker }) => {
  await seedReachedRule(serviceWorker, '127\\.0\\.0\\.1');
  const page = await context.newPage();
  await page.goto(blocked(extensionId, 'r1', `${origin}/`));

  await expect(page.getByTestId('blocked-title')).toHaveText('Daily limit reached');
  await expect(page.getByTestId('blocked-pattern')).toHaveText('127\\.0\\.0\\.1');
  await expect(page.getByTestId('blocked-used')).toHaveText('5m 00s');
  await expect(page.getByTestId('blocked-limit')).toHaveText('5m');
  await expect(page.getByTestId('continue')).toBeDisabled();
});

test('extending the limit re-enables Continue and returns to the original page', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await seedReachedRule(serviceWorker, '127\\.0\\.0\\.1');
  const page = await context.newPage();
  await page.goto(blocked(extensionId, 'r1', `${origin}/`));

  await page.getByTestId('extend-5').click();
  await expect(page.getByTestId('blocked-limit')).toHaveText('10m');
  await expect(page.getByTestId('continue')).toBeEnabled();

  await page.getByTestId('continue').click();
  await page.waitForURL(`${origin}/`);
  await expect(page.getByRole('heading', { name: 'Time sink' })).toBeVisible();
});

test('the +10 button raises the limit by ten minutes', async ({ context, extensionId, serviceWorker }) => {
  await seedReachedRule(serviceWorker, '127\\.0\\.0\\.1');
  const page = await context.newPage();
  await page.goto(blocked(extensionId, 'r1', `${origin}/`));

  await page.getByTestId('extend-10').click();
  await expect(page.getByTestId('blocked-limit')).toHaveText('15m');
});

test('a custom amount raises the limit by the entered minutes', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await seedReachedRule(serviceWorker, '127\\.0\\.0\\.1');
  const page = await context.newPage();
  await page.goto(blocked(extensionId, 'r1', `${origin}/`));

  await page.getByTestId('custom-minutes').fill('2');
  await page.getByTestId('extend-custom-submit').click();

  await expect(page.getByTestId('blocked-limit')).toHaveText('7m');
  await expect(page.getByTestId('continue')).toBeEnabled();
});

test('the extension redirects a matching tab that is over its limit', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await seedReachedRule(serviceWorker, '127\\.0\\.0\\.1');
  const page = await context.newPage();

  await page.goto(`${origin}/`);
  await page.waitForURL(/blocked\.html/, { timeout: 15_000 });

  expect(page.url()).toContain(`chrome-extension://${extensionId}/blocked.html`);
  await expect(page.getByTestId('blocked-title')).toHaveText('Daily limit reached');
  await expect(page.getByTestId('blocked-pattern')).toHaveText('127\\.0\\.0\\.1');
});

test('a matching tab under its limit is not redirected', async ({ context, extensionId, serviceWorker }) => {
  await seed(serviceWorker, {
    rules: [{ id: 'r1', pattern: '127\\.0\\.0\\.1', limitMinutes: 5, createdAt: Date.now() }],
    usage: { date: today(), seconds: { r1: 0 } },
  });
  const page = await context.newPage();
  await page.goto(`${origin}/`);

  // Give the service worker a chance to (not) act.
  await page.waitForTimeout(1500);
  expect(page.url()).toBe(`${origin}/`);
  await expect(page.getByRole('heading', { name: 'Time sink' })).toBeVisible();
  void extensionId;
});

test('after extending, returning to the site is allowed', async ({ context, extensionId, serviceWorker }) => {
  await seedReachedRule(serviceWorker, '127\\.0\\.0\\.1');
  const page = await context.newPage();

  // Get blocked by real enforcement first.
  await page.goto(`${origin}/`);
  await page.waitForURL(/blocked\.html/, { timeout: 15_000 });

  // Extend, then continue back to the site; it should now load without redirecting.
  await page.getByTestId('extend-10').click();
  await expect(page.getByTestId('continue')).toBeEnabled();
  await page.getByTestId('continue').click();
  await page.waitForURL(`${origin}/`);
  await expect(page.getByRole('heading', { name: 'Time sink' })).toBeVisible();
});
