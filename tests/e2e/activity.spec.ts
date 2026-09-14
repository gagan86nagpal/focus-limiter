import type { Page, Worker } from '@playwright/test';
import { clearStorage, expect, seed, seedActivity, test } from './fixtures';

const dashboard = (id: string) => `chrome-extension://${id}/dashboard.html`;

/** Midnight today, so seeded segments land on the day the dashboard opens on. */
function midnight(dayOffset = 0): number {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + dayOffset);
  return date.getTime();
}

function dayKey(dayOffset = 0): string {
  const date = new Date(midnight(dayOffset));
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A segment starting `hour`:`minute` today, lasting `minutes`. */
function segment(host: string, path: string, hour: number, minute: number, minutes: number, dayOffset = 0) {
  const startedAt = midnight(dayOffset) + (hour * 60 + minute) * 60_000;
  return {
    url: `https://${host}${path}`,
    host,
    startedAt,
    endedAt: startedAt + minutes * 60_000,
  };
}

const TODAY = [
  segment('news.example', '/live', 9, 0, 30),
  segment('news.example', '/live', 14, 0, 10),
  segment('video.example', '/watch', 10, 0, 20),
  segment('forum.example', '/thread', 11, 30, 5),
];

async function seedToday(worker: Worker): Promise<void> {
  await seedActivity(worker, [{ date: dayKey(), segments: TODAY }]);
}

async function openActivity(page: Page, extensionId: string): Promise<void> {
  await page.goto(dashboard(extensionId));
  await page.getByTestId('tab-activity').click();
  await expect(page.getByTestId('panel-activity')).toBeVisible();
}

test.beforeEach(async ({ serviceWorker }) => {
  await clearStorage(serviceWorker);
});

test('the dashboard opens on rules and keeps activity out of the way', async ({ page, extensionId }) => {
  await page.goto(dashboard(extensionId));

  await expect(page.getByTestId('panel-rules')).toBeVisible();
  await expect(page.getByTestId('panel-activity')).toBeHidden();
  await expect(page.getByTestId('tab-rules')).toHaveAttribute('aria-selected', 'true');
});

test('switching tabs swaps the panels', async ({ page, extensionId, serviceWorker }) => {
  await seedToday(serviceWorker);
  await openActivity(page, extensionId);

  await expect(page.getByTestId('panel-rules')).toBeHidden();
  await expect(page.getByTestId('tab-activity')).toHaveAttribute('aria-selected', 'true');

  await page.getByTestId('tab-rules').click();
  await expect(page.getByTestId('panel-rules')).toBeVisible();
  await expect(page.getByTestId('panel-activity')).toBeHidden();
});

test('the arrow keys move between tabs', async ({ page, extensionId }) => {
  await page.goto(dashboard(extensionId));

  await page.getByTestId('tab-rules').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('panel-activity')).toBeVisible();

  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('panel-rules')).toBeVisible();
});

test('the day summarises time, sites, and the busiest minute', async ({ page, extensionId, serviceWorker }) => {
  await seedToday(serviceWorker);
  await openActivity(page, extensionId);

  await expect(page.getByTestId('activity-total')).toHaveText('1h 05m');
  await expect(page.getByTestId('activity-sites')).toHaveText('3');
  // The 09:00 hour holds half an hour of news.example, more than any other hour of the day.
  await expect(page.getByTestId('activity-peak')).toHaveText('09:00');
  await expect(page.getByTestId('activity-peak-sub')).toHaveText('30m of that hour');
  await expect(page.getByTestId('activity-day-label')).toHaveText('Today');
});

test('the chart draws a block for every stretch of browsing', async ({ page, extensionId, serviceWorker }) => {
  await seedToday(serviceWorker);
  await openActivity(page, extensionId);

  // Four separate sittings, each its own block.
  await expect(page.locator('#activity-chart .tl-bar')).toHaveCount(4);
});

test('hovering the chart names the site being viewed at that minute', async ({
  page,
  extensionId,
  serviceWorker,
}) => {
  await seedToday(serviceWorker);
  await openActivity(page, extensionId);

  const chart = page.getByTestId('activity-chart');
  const box = (await chart.boundingBox())!;
  // 10:10 in the morning, inside the video.example stretch.
  await page.mouse.move(box.x + box.width * ((10 * 60 + 10) / 1440), box.y + box.height / 2);

  // The exact minute depends on where the pointer lands in a 1440-minute-wide chart, so
  // assert the hour and the site rather than a pixel-perfect minute.
  const tooltip = page.getByTestId('activity-tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('video.example');
  await expect(tooltip).toContainText(/10:\d\d/);
  await expect(page.getByTestId('activity-hint')).toHaveText(/^10:\d\d · video\.example$/);
});

test('clicking the chart zooms into that hour, and the chip goes back to the day', async ({
  page,
  extensionId,
  serviceWorker,
}) => {
  await seedToday(serviceWorker);
  await openActivity(page, extensionId);

  const chart = page.getByTestId('activity-chart');
  const chip = page.getByTestId('activity-zoom-out');
  const axis = page.locator('#activity-axis span');
  // video.example ran 10:00-10:20, the second stretch of the day.
  const videoBar = page.locator('#activity-chart .tl-bar').nth(1);

  await expect(chip).toBeHidden();
  await expect(axis).toHaveText(['00:00', '06:00', '12:00', '18:00', '24:00']);
  const dayWidth = (await videoBar.boundingBox())!.width;

  const box = (await chart.boundingBox())!;
  await chart.click({
    position: { x: box.width * ((10 * 60 + 10) / 1440), y: box.height / 2 },
  });

  await expect(chip).toBeVisible();
  await expect(page.getByTestId('activity-zoom-range')).toHaveText('10:00–11:00');
  await expect(chart).toHaveClass(/is-zoomed/);
  await expect(axis).toHaveText(['10:00', '10:15', '10:30', '10:45', '11:00']);

  // Twenty minutes is a sliver of a day and a third of an hour, so the block really did grow.
  await expect
    .poll(async () => (await videoBar.boundingBox())!.width)
    .toBeGreaterThan(dayWidth * 5);

  // The pointer maths follows the zoom: ten minutes in is 10:10, still video.example.
  await page.mouse.move(box.x + box.width * (10 / 60), box.y + box.height / 2);
  await expect(page.getByTestId('activity-tooltip')).toContainText('video.example');
  await expect(page.getByTestId('activity-hint')).toHaveText(/^10:\d\d · video\.example$/);

  await chip.click();

  await expect(chip).toBeHidden();
  await expect(chart).not.toHaveClass(/is-zoomed/);
  await expect(axis).toHaveText(['00:00', '06:00', '12:00', '18:00', '24:00']);
});

test('moving to another day drops the zoom', async ({ page, extensionId, serviceWorker }) => {
  await seedActivity(serviceWorker, [
    { date: dayKey(), segments: TODAY },
    { date: dayKey(-1), segments: [segment('archive.example', '/old', 8, 0, 45, -1)] },
  ]);
  await openActivity(page, extensionId);

  const chart = page.getByTestId('activity-chart');
  const box = (await chart.boundingBox())!;
  await chart.click({ position: { x: box.width * (610 / 1440), y: box.height / 2 } });
  await expect(page.getByTestId('activity-zoom-out')).toBeVisible();

  await page.getByTestId('activity-prev').click();

  await expect(page.getByTestId('activity-day-label')).toHaveText('Yesterday');
  await expect(page.getByTestId('activity-zoom-out')).toBeHidden();
  await expect(page.locator('#activity-axis span')).toHaveText([
    '00:00',
    '06:00',
    '12:00',
    '18:00',
    '24:00',
  ]);
});

test('hovering a site dims the rest of the chart', async ({ page, extensionId, serviceWorker }) => {
  await seedToday(serviceWorker);
  await openActivity(page, extensionId);

  await page.getByTestId('activity-row').first().hover();

  await expect(page.getByTestId('activity-chart')).toHaveClass(/is-dimmed/);
  // news.example was visited twice, in the morning and after lunch.
  await expect(page.locator('#activity-chart .tl-bar.is-lit')).toHaveCount(2);
});

test('the legend pins a site until it is clicked again', async ({ page, extensionId, serviceWorker }) => {
  await seedToday(serviceWorker);
  await openActivity(page, extensionId);

  const legendItem = page.getByTestId('activity-legend-item').nth(1);
  await legendItem.click();
  await expect(legendItem).toHaveClass(/is-pinned/);
  await expect(page.getByTestId('activity-chart')).toHaveClass(/is-dimmed/);

  await legendItem.click();
  await expect(page.getByTestId('activity-chart')).not.toHaveClass(/is-dimmed/);
});

test('sites are ranked by time with their share of the day', async ({ page, extensionId, serviceWorker }) => {
  await seedToday(serviceWorker);
  await openActivity(page, extensionId);

  const rows = page.getByTestId('activity-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).getByTestId('activity-host')).toHaveText('news.example');
  await expect(rows.nth(0).getByTestId('activity-time')).toHaveText('40m');
  await expect(rows.nth(0).getByTestId('activity-share')).toHaveText('62% · 2 visits');
  await expect(rows.nth(1).getByTestId('activity-host')).toHaveText('video.example');
  await expect(rows.nth(2).getByTestId('activity-host')).toHaveText('forum.example');
});

test('a site already under a limit shows a badge instead of a block form', async ({
  page,
  extensionId,
  serviceWorker,
}) => {
  await seed(serviceWorker, {
    rules: [{ id: 'r1', pattern: 'video\\.example', limitMinutes: 15, createdAt: Date.now() }],
    usage: { date: dayKey(), seconds: {} },
  });
  await seedToday(serviceWorker);
  await openActivity(page, extensionId);

  const video = page.getByTestId('activity-row').filter({ hasText: 'video.example' });
  await expect(video.getByTestId('activity-has-rule')).toBeVisible();
  await expect(video.getByTestId('activity-block')).toBeHidden();
  await expect(page.getByTestId('activity-covered')).toHaveText('31%');
});

test('blocking a site from the list creates a rule and updates both tabs', async ({
  page,
  extensionId,
  serviceWorker,
}) => {
  await seedToday(serviceWorker);
  await openActivity(page, extensionId);

  const top = page.getByTestId('activity-row').first();
  await top.getByTestId('activity-minutes').fill('20');
  await top.getByTestId('activity-block').click();

  await expect(top.getByTestId('activity-has-rule')).toBeVisible();

  await page.getByTestId('tab-rules').click();
  await expect(page.getByTestId('rule-card')).toHaveCount(1);
  await expect(page.getByTestId('rule-card').getByTestId('rule-limit')).toHaveText('20m');
  await expect(page.getByTestId('rule-count')).toHaveText('1 of 10');
});

test('the date picker walks back through history', async ({ page, extensionId, serviceWorker }) => {
  await seedActivity(serviceWorker, [
    { date: dayKey(), segments: TODAY },
    { date: dayKey(-1), segments: [segment('archive.example', '/old', 8, 0, 45, -1)] },
  ]);
  await openActivity(page, extensionId);

  await expect(page.getByTestId('activity-next')).toBeDisabled();
  await expect(page.getByTestId('activity-today')).toBeDisabled();

  await page.getByTestId('activity-prev').click();

  await expect(page.getByTestId('activity-day-label')).toHaveText('Yesterday');
  await expect(page.getByTestId('activity-total')).toHaveText('45m');
  await expect(page.getByTestId('activity-row')).toHaveCount(1);
  await expect(page.getByTestId('activity-row').getByTestId('activity-host')).toHaveText('archive.example');

  await page.getByTestId('activity-today').click();
  await expect(page.getByTestId('activity-day-label')).toHaveText('Today');
  await expect(page.getByTestId('activity-total')).toHaveText('1h 05m');
});

test('a day with no history shows a resting state', async ({ page, extensionId, serviceWorker }) => {
  await seedToday(serviceWorker);
  await openActivity(page, extensionId);

  await page.getByTestId('activity-prev').click();

  await expect(page.getByTestId('activity-empty')).toBeVisible();
  await expect(page.getByTestId('activity-total')).toHaveText('0s');
  await expect(page.getByTestId('activity-row')).toHaveCount(0);
});

test('the activity tab follows the theme toggle', async ({ page, extensionId, serviceWorker }) => {
  await seedToday(serviceWorker);
  await openActivity(page, extensionId);

  await page.getByTestId('theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  const background = await page
    .getByTestId('activity-chart')
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(background).toBe('rgb(31, 31, 31)');
});
