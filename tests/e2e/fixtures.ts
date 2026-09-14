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

/**
 * Replaces stored rules and usage, as the extension would after edits.
 *
 * This writes around the tracker rather than through its serialised queue, so a reconcile that
 * is mid read-modify-write can still land on top of it. Writing and then confirming the values
 * actually stuck keeps that from silently starting a test with an empty store.
 */
export async function seed(
  worker: Worker,
  data: { rules?: unknown[]; usage?: unknown },
): Promise<void> {
  await expect(async () => {
    const stored = await worker.evaluate(async (payload) => {
      await chrome.storage.local.set(payload as Record<string, unknown>);
      return chrome.storage.local.get(Object.keys(payload));
    }, data);
    expect(stored).toEqual(data);
  }).toPass({ timeout: 10_000 });
}

export async function clearStorage(worker: Worker): Promise<void> {
  await worker.evaluate(async () => {
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
  });
}
