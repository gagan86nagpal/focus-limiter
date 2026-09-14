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

export interface SeedData {
  rules?: unknown[];
  usage?: { date: string; seconds: Record<string, number> };
}

/**
 * Replaces stored rules and usage, as the extension would after edits.
 *
 * This writes around the tracker rather than through its serialised queue, so a reconcile that
 * read the store before this write can still be queued behind it, and its `saveUsage` then
 * puts the old, empty usage back. Confirming the write landed is not enough on its own,
 * because the overwrite arrives a moment afterwards and leaves the test running against a
 * budget it never asked for. So the write is repeated until the values are still in place
 * after a pause.
 *
 * Seeded seconds are allowed to have grown, since a live session legitimately adds to them,
 * but they must never have gone backwards.
 */
export async function seed(worker: Worker, data: SeedData): Promise<void> {
  const keys = Object.keys(data);
  await expect(async () => {
    await worker.evaluate(async (payload) => {
      await chrome.storage.local.set(payload as Record<string, unknown>);
    }, data);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const stored = await worker.evaluate(async (k) => chrome.storage.local.get(k as string[]), keys);
    if (data.rules !== undefined) expect(stored['rules']).toEqual(data.rules);
    if (data.usage !== undefined) {
      const usage = stored['usage'] as SeedData['usage'];
      expect(usage?.date).toBe(data.usage.date);
      for (const [id, seconds] of Object.entries(data.usage.seconds)) {
        expect(usage?.seconds[id] ?? -1).toBeGreaterThanOrEqual(seconds);
      }
    }
  }).toPass({ timeout: 15_000, intervals: [250] });
}

/** Replaces the rolling activity history, which lives under its own storage key. */
export async function seedActivity(worker: Worker, days: unknown[]): Promise<void> {
  await expect(async () => {
    const stored = await worker.evaluate(async (activity) => {
      await chrome.storage.local.set({ activity });
      return chrome.storage.local.get(['activity']);
    }, days);
    expect(stored).toEqual({ activity: days });
  }).toPass({ timeout: 10_000 });
}

/**
 * Waits for Chrome's opening idle verdict to land.
 *
 * chrome.idle measures input to the whole machine, so on a computer nobody is touching Chrome
 * decides the user is idle about a second after the worker starts, and the tracker stops
 * opening sessions. Whether that arrived before or after a test seeded its data was down to
 * luck, which is what made enforcement look flaky: the suite passed when a developer happened
 * to be typing and failed when they were not.
 *
 * The state is only broadcast when it changes, so once the stored presence agrees with the
 * queried state there is nothing left to arrive, and the `clearStorage` that follows leaves a
 * stable `active` behind. The threshold matches the detection interval the extension runs on.
 */
export async function settlePresence(worker: Worker): Promise<void> {
  await expect(async () => {
    const agreed = await worker.evaluate(async () => {
      const actual = await new Promise<string>((resolve) => chrome.idle.queryState(60, resolve));
      const stored = (await chrome.storage.session.get(['presence']))['presence'] ?? 'active';
      return actual === stored;
    });
    expect(agreed, 'idle state has settled').toBe(true);
  }).toPass({ timeout: 15_000, intervals: [100] });
}

/** Returns the worker to a known state: no stored data, and a presence that will not drift. */
export async function clearStorage(worker: Worker): Promise<void> {
  await settlePresence(worker);
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
