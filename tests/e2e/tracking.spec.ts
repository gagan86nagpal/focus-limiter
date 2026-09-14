import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { clearStorage, expect, seed, test, todayKey, waitForBlockedRedirect } from './fixtures';

let server: http.Server;
let origin: string;

test.beforeAll(async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>Time sink</title><h1>Time sink</h1>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test.beforeEach(async ({ serviceWorker }) => {
  await clearStorage(serviceWorker);
});

test('accrues time on a matching tab and blocks when the limit is crossed', async ({
  context,
  serviceWorker,
}) => {
  // Limit is 5 minutes (300s); already 298s used, so ~2s of viewing should trip it.
  await seed(serviceWorker, {
    rules: [{ id: 'r1', pattern: '127\\.0\\.0\\.1', limitMinutes: 5, createdAt: Date.now() }],
    usage: { date: await todayKey(serviceWorker), seconds: { r1: 298 } },
  });

  const page = await context.newPage();
  await page.bringToFront();
  await page.goto(`${origin}/`);

  // The page loads (not immediately blocked), then the ticker enforces the deadline.
  // Wake the worker while we wait: Chrome may otherwise sleep it and miss the 2s deadline.
  await waitForBlockedRedirect(page, context, serviceWorker);
  await expect(page.getByTestId('blocked-title')).toHaveText('Daily limit reached');
});
