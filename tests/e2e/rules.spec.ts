import { clearStorage, expect, seed, test } from './fixtures';
import type { Page } from '@playwright/test';

const dashboard = (id: string) => `chrome-extension://${id}/dashboard.html`;

async function openDashboard(page: Page, id: string): Promise<void> {
  await page.goto(dashboard(id));
  await expect(page.getByTestId('rule-count')).toBeVisible();
}

test.beforeEach(async ({ serviceWorker }) => {
  await clearStorage(serviceWorker);
});

test('shows the empty state before any rules exist', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await openDashboard(page, extensionId);
  await expect(page.getByTestId('empty-state')).toBeVisible();
  await expect(page.getByTestId('rule-count')).toHaveText('0 of 10');
});

test('creates a rule through the dialog', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await openDashboard(page, extensionId);

  await page.getByTestId('add-rule').click();
  await expect(page.getByTestId('rule-dialog')).toBeVisible();
  await page.getByTestId('pattern-input').fill('youtube\\.com/shorts.*');
  await page.getByTestId('limit-input').fill('10');
  await page.getByTestId('save-rule').click();

  const card = page.getByTestId('rule-card');
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId('rule-limit')).toHaveText('10m');
  await expect(page.getByTestId('rule-count')).toHaveText('1 of 10');
  await expect(page.getByTestId('empty-state')).toBeHidden();
});

test('gives live regex and match feedback', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await openDashboard(page, extensionId);
  await page.getByTestId('add-rule').click();

  const pattern = page.getByTestId('pattern-input');
  const testUrl = page.getByTestId('test-url-input');
  const status = page.getByTestId('match-status');

  await pattern.fill('(');
  await expect(status).toHaveText('✕ Invalid regular expression');

  await pattern.fill('shorts');
  await testUrl.fill('https://youtube.com/shorts/abc');
  await expect(status).toHaveText('✓ This URL matches this rule');

  await testUrl.fill('https://youtube.com/watch');
  await expect(status).toHaveText('○ This URL does not match this rule');
});

test('rejects an invalid pattern on save', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await openDashboard(page, extensionId);
  await page.getByTestId('add-rule').click();
  await page.getByTestId('pattern-input').fill('(');
  await page.getByTestId('save-rule').click();

  await expect(page.getByTestId('pattern-error')).toHaveText('Invalid regular expression');
  await expect(page.getByTestId('rule-card')).toHaveCount(0);
});

test('edits an existing rule', async ({ context, extensionId, serviceWorker }) => {
  await seed(serviceWorker, {
    rules: [{ id: 'r1', pattern: 'old\\.com', limitMinutes: 5, createdAt: Date.now() }],
    usage: { date: new Date().toISOString().slice(0, 10), seconds: {} },
  });
  const page = await context.newPage();
  await openDashboard(page, extensionId);

  await page.getByTestId('edit-rule').click();
  await expect(page.getByTestId('pattern-input')).toHaveValue('old\\.com');
  await page.getByTestId('pattern-input').fill('new\\.com');
  await page.getByTestId('limit-input').fill('25');
  await page.getByTestId('save-rule').click();

  const card = page.getByTestId('rule-card');
  await expect(card.getByTestId('rule-limit')).toHaveText('25m');
  await expect(card).toContainText('new\\.com');
});

test('deletes a rule after confirmation', async ({ context, extensionId, serviceWorker }) => {
  await seed(serviceWorker, {
    rules: [{ id: 'r1', pattern: 'x\\.com', limitMinutes: 5, createdAt: Date.now() }],
    usage: { date: new Date().toISOString().slice(0, 10), seconds: {} },
  });
  const page = await context.newPage();
  await openDashboard(page, extensionId);

  await page.getByTestId('delete-rule').click();
  await page.getByTestId('confirm-delete').click();

  await expect(page.getByTestId('rule-card')).toHaveCount(0);
  await expect(page.getByTestId('empty-state')).toBeVisible();
});

test('enforces the maximum of ten rules', async ({ context, extensionId, serviceWorker }) => {
  const rules = Array.from({ length: 10 }, (_, i) => ({
    id: `r${i}`,
    pattern: `site${i}\\.com`,
    limitMinutes: 5,
    createdAt: Date.now(),
  }));
  await seed(serviceWorker, { rules, usage: { date: new Date().toISOString().slice(0, 10), seconds: {} } });
  const page = await context.newPage();
  await openDashboard(page, extensionId);

  await expect(page.getByTestId('rule-count')).toHaveText('10 of 10');
  await expect(page.getByTestId('add-rule')).toBeDisabled();
  await expect(page.getByTestId('limit-notice')).toBeVisible();
});
