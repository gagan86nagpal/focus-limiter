import { dateKey } from '../shared/time';
import type { ActivityDay, Presence, Rule, RuntimeState, StoredData, UsageDay } from '../shared/types';

export function emptyUsage(now: number): UsageDay {
  return { date: dateKey(now), seconds: {} };
}

/** Loads durable data. Usage from a previous day is discarded, which is how the daily reset works. */
export async function loadData(now: number): Promise<StoredData> {
  const raw = await chrome.storage.local.get(['rules', 'usage']);
  const rules = Array.isArray(raw['rules']) ? (raw['rules'] as Rule[]) : [];
  const usage = raw['usage'] as UsageDay | undefined;
  return {
    rules,
    usage: usage !== undefined && usage.date === dateKey(now) ? usage : emptyUsage(now),
  };
}

export async function saveData(data: StoredData): Promise<void> {
  await chrome.storage.local.set({ rules: data.rules, usage: data.usage });
}

/**
 * Persists usage without touching `rules`. Reconcile only ever changes usage, so writing the
 * rules it happened to read back would clobber any rule edit made since that read.
 */
export async function saveUsage(usage: UsageDay): Promise<void> {
  await chrome.storage.local.set({ usage });
}

/**
 * The rolling activity history. Kept under its own key, and written on its own, so recording
 * a page view never rewrites `rules` or `usage`.
 */
export async function loadActivity(): Promise<ActivityDay[]> {
  const raw = await chrome.storage.local.get(['activity']);
  const days = raw['activity'];
  return Array.isArray(days) ? (days as ActivityDay[]) : [];
}

export async function saveActivity(days: ActivityDay[]): Promise<void> {
  await chrome.storage.local.set({ activity: days });
}

/** Volatile state lives in storage.session so it survives worker restarts but not browser restarts. */
export async function loadRuntime(): Promise<RuntimeState> {
  const raw = await chrome.storage.session.get(['session', 'focused', 'presence']);
  return {
    session: (raw['session'] as RuntimeState['session'] | undefined) ?? null,
    focused: (raw['focused'] as boolean | undefined) ?? true,
    presence: (raw['presence'] as Presence | undefined) ?? 'active',
  };
}

export async function saveRuntime(state: RuntimeState): Promise<void> {
  await chrome.storage.session.set({
    session: state.session,
    focused: state.focused,
    presence: state.presence,
  });
}
