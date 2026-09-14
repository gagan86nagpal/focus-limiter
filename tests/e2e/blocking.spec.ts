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

test('the page pops past its resting size and settles back', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await seedReachedRule(serviceWorker, '127\\.0\\.0\\.1');
  const page = await context.newPage();

  // Sampling has to be installed before the first paint, because the whole thing is over in
  // under a third of a second. Asserting the computed scale, rather than that some animation is
  // declared, is the only way to catch an entrance that technically runs but cannot be seen.
  await page.addInitScript(() => {
    const scales: number[] = [];
    Object.assign(window, { __scales: scales });
    const tick = (): void => {
      const card = document.querySelector('.blocked');
      if (card !== null) {
        const { transform } = getComputedStyle(card);
        scales.push(transform === 'none' ? 1 : new DOMMatrixReadOnly(transform).a);
      }
      if (performance.now() < 800) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await page.goto(blocked(extensionId, 'r1', `${origin}/`));
  await page.waitForTimeout(900);

  const scales = await page.evaluate(() => (window as unknown as { __scales: number[] }).__scales);
  expect(scales.length).toBeGreaterThan(10);
  // Arrives small, overshoots full size by enough to see, and comes to rest at exactly full.
  expect(Math.min(...scales)).toBeLessThanOrEqual(0.9);
  expect(Math.max(...scales)).toBeGreaterThan(1.02);
  expect(scales.at(-1)).toBe(1);
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
