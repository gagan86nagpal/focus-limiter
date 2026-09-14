import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  // Launching many Chromium instances at once (each with the extension loaded)
  // starves service-worker startup; cap parallelism for stable runs.
  workers: process.env['CI'] ? 2 : 4,
  // One retry absorbs the occasional slow browser/service-worker launch.
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
  },
});
