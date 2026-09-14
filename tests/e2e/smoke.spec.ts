import { expect, test } from './fixtures';

test('the extension loads and its service worker starts', async ({ extensionId, serviceWorker }) => {
  expect(extensionId).toMatch(/^[a-z]{32}$/);
  expect(serviceWorker.url()).toContain('background.js');
});

test('the dashboard renders its heading', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
  await expect(page.getByRole('heading', { name: 'Focus Limiter' })).toBeVisible();
});
