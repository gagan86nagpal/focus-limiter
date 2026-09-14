import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const extensionPath = path.resolve(import.meta.dirname, '../../dist');

export interface ExtensionFixtures {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
}

export const test = base.extend<ExtensionFixtures>({
  context: async ({}, use) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-limiter-e2e-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-first-run',
      ],
    });
    await use(context);
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  },
  serviceWorker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker', { timeout: 30_000 });
    await use(worker);
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },
});

export const expect = test.expect;

/** Replaces stored rules and usage, as the extension would after edits. */
export async function seed(
  worker: Worker,
  data: { rules?: unknown[]; usage?: unknown },
): Promise<void> {
  await worker.evaluate(async (payload) => {
    await chrome.storage.local.set(payload as Record<string, unknown>);
  }, data);
}

export async function clearStorage(worker: Worker): Promise<void> {
  await worker.evaluate(async () => {
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
  });
}
