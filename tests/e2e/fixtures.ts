import { test as base, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
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

/** Chrome's local calendar date, which is what `loadData` keys usage on. */
export async function todayKey(worker: Worker): Promise<string> {
  return worker.evaluate(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });
}

/**
 * Touches the MV3 worker so Chrome does not sleep it.
 *
 * The 1s enforcement ticker lives in the worker as `setInterval`. Sleeping the worker kills that
 * timer, and `chrome.alarms` then delays a short `when` to ~30s — past typical e2e timeouts.
 */
export async function wakeServiceWorker(context: BrowserContext, worker: Worker): Promise<Worker> {
  try {
    await worker.evaluate(() => undefined);
    return worker;
  } catch {
    const existing = context.serviceWorkers()[0];
    const next = existing ?? (await context.waitForEvent('serviceworker', { timeout: 10_000 }));
    await next.evaluate(() => undefined);
    return next;
  }
}

/** Waits until enforcement redirects `page`, keeping the worker alive so the ticker can fire. */
export async function waitForBlockedRedirect(page: Page, context: BrowserContext, worker: Worker): Promise<void> {
  let current = worker;
  await expect(async () => {
    await page.bringToFront();
    current = await wakeServiceWorker(context, current);
    expect(page.url()).toMatch(/blocked\.html/);
  }).toPass({ timeout: 15_000, intervals: [200] });
}
