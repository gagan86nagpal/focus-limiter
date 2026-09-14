import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';
import { clearStorage, expect, seed, test, todayKey, waitForBlockedRedirect } from './fixtures';

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

const blocked = (id: string, ruleId: string, url: string) =>
  `chrome-extension://${id}/blocked.html?rule=${ruleId}&url=${encodeURIComponent(url)}`;

test.beforeEach(async ({ serviceWorker }) => {
  await clearStorage(serviceWorker);
});

async function seedReachedRule(worker: Parameters<typeof seed>[0], pattern: string): Promise<void> {
  await seed(worker, {
    rules: [{ id: 'r1', pattern, limitMinutes: 5, createdAt: Date.now() }],
    usage: { date: await todayKey(worker), seconds: { r1: 300 } },
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

test('choosing an amount spends nothing until Continue', async ({ context, extensionId, serviceWorker }) => {
  await seedReachedRule(serviceWorker, '127\\.0\\.0\\.1');
  const page = await context.newPage();
  await page.goto(blocked(extensionId, 'r1', `${origin}/`));

  await page.getByTestId('extend-5').click();

  // Still five minutes: the choice has been made but nothing has been spent.
  await expect(page.getByTestId('blocked-limit')).toHaveText('5m');
  await expect(page.getByTestId('blocked-title')).toHaveText('Daily limit reached');
  await expect(page.getByTestId('blocked-hint')).toHaveText('+5 min is added when you continue.');
  await expect(page.getByTestId('continue')).toHaveText('Add 5 min and continue');
  await expect(page.getByTestId('extend-5')).toHaveAttribute('aria-pressed', 'true');

  // Reloading throws the choice away, rather than the limit having quietly crept up.
  await page.reload();
  await expect(page.getByTestId('blocked-limit')).toHaveText('5m');
  await expect(page.getByTestId('continue')).toBeDisabled();
});

test('Continue raises the limit and returns to the original page', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await seedReachedRule(serviceWorker, '127\\.0\\.0\\.1');
  const page = await context.newPage();
  await page.goto(blocked(extensionId, 'r1', `${origin}/`));

  await page.getByTestId('extend-5').click();
  await expect(page.getByTestId('continue')).toBeEnabled();
  await page.getByTestId('continue').click();

  await page.waitForURL(`${origin}/`);
  await expect(page.getByRole('heading', { name: 'Time sink' })).toBeVisible();
});

test('clicking the chosen amount again takes it back off', async ({ context, extensionId, serviceWorker }) => {
  await seedReachedRule(serviceWorker, '127\\.0\\.0\\.1');
  const page = await context.newPage();
  await page.goto(blocked(extensionId, 'r1', `${origin}/`));

  await page.getByTestId('extend-5').click();
  await page.getByTestId('extend-5').click();

  await expect(page.getByTestId('extend-5')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('continue')).toHaveText('Continue');
  await expect(page.getByTestId('continue')).toBeDisabled();
});

test('the +10 button raises the limit by ten minutes, once continued', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await seedReachedRule(serviceWorker, '127\\.0\\.0\\.1');
  const page = await context.newPage();
  await page.goto(blocked(extensionId, 'r1', `${origin}/`));

  await page.getByTestId('extend-10').click();
  await expect(page.getByTestId('blocked-limit')).toHaveText('5m');

  await page.getByTestId('continue').click();
  await page.waitForURL(`${origin}/`);

  // Coming back shows the rule carrying the larger limit, so the spend really landed.
  await page.goto(blocked(extensionId, 'r1', `${origin}/`));
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
  await expect(page.getByTestId('continue')).toHaveText('Add 2 min and continue');

  await page.getByTestId('continue').click();
  await page.waitForURL(`${origin}/`);

  await page.goto(blocked(extensionId, 'r1', `${origin}/`));
  await expect(page.getByTestId('blocked-limit')).toHaveText('7m');
});

test('the page pops in rather than appearing as if it had always been there', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await seedReachedRule(serviceWorker, '127\\.0\\.0\\.1');
  const page = await context.newPage();
  await page.goto(blocked(extensionId, 'r1', `${origin}/`));

  const card = page.locator('.blocked');
  await expect(card).toBeVisible();
  const animation = await card.evaluate((node) => {
    const style = getComputedStyle(node);
    return { name: style.animationName, duration: style.animationDuration };
  });
  expect(animation.name).toBe('blocked-pop');
  expect(animation.duration).toBe('0.26s');

  // It settles, rather than leaving the card mid-flight. The animation fills both ways, so the
  // resting state is the identity matrix rather than no transform at all.
  await expect
    .poll(async () => card.evaluate((node) => getComputedStyle(node).transform))
    .toBe('matrix(1, 0, 0, 1, 0, 0)');
});

test('the pop is dropped for anyone who asked for less motion', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await seedReachedRule(serviceWorker, '127\\.0\\.0\\.1');
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(blocked(extensionId, 'r1', `${origin}/`));

  const name = await page.locator('.blocked').evaluate((node) => getComputedStyle(node).animationName);
  expect(name).toBe('none');
});

test('the way out of the page lifts under the pointer', async ({ context, extensionId, serviceWorker }) => {
  await seedReachedRule(serviceWorker, '127\\.0\\.0\\.1');
  const page = await context.newPage();
  await page.goto(blocked(extensionId, 'r1', `${origin}/`));

  const extend = page.getByTestId('extend-5');
  const transform = () => extend.evaluate((node) => getComputedStyle(node).transform);
  expect(await transform()).toBe('none');

  await extend.hover();

  // A one-pixel lift, which is the last number in the matrix.
  await expect.poll(transform).toBe('matrix(1, 0, 0, 1, 0, -1)');
});

test('the extension redirects a matching tab that is over its limit', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await seedReachedRule(serviceWorker, '127\\.0\\.0\\.1');
  const page = await context.newPage();

  await page.goto(`${origin}/`);
  await waitForBlockedRedirect(page, context, serviceWorker);

  expect(page.url()).toContain(`chrome-extension://${extensionId}/blocked.html`);
  await expect(page.getByTestId('blocked-title')).toHaveText('Daily limit reached');
  await expect(page.getByTestId('blocked-pattern')).toHaveText('127\\.0\\.0\\.1');
});

test('a matching tab under its limit is not redirected', async ({ context, extensionId, serviceWorker }) => {
  await seed(serviceWorker, {
    rules: [{ id: 'r1', pattern: '127\\.0\\.0\\.1', limitMinutes: 5, createdAt: Date.now() }],
    usage: { date: await todayKey(serviceWorker), seconds: { r1: 0 } },
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
  await waitForBlockedRedirect(page, context, serviceWorker);

  // Extend, then continue back to the site; it should now load without redirecting.
  await page.getByTestId('extend-10').click();
  await expect(page.getByTestId('continue')).toBeEnabled();
  await page.getByTestId('continue').click();
  await page.waitForURL(`${origin}/`);
  await expect(page.getByRole('heading', { name: 'Time sink' })).toBeVisible();
});
