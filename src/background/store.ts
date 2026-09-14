import { dateKey } from '../shared/time';
import type { Rule, RuntimeState, StoredData, UsageDay } from '../shared/types';

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

/** Volatile state lives in storage.session so it survives worker restarts but not browser restarts. */
export async function loadRuntime(): Promise<RuntimeState> {
  const raw = await chrome.storage.session.get(['session', 'focused', 'idle']);
  return {
    session: (raw['session'] as RuntimeState['session'] | undefined) ?? null,
    focused: (raw['focused'] as boolean | undefined) ?? true,
    idle: (raw['idle'] as boolean | undefined) ?? false,
  };
}

export async function saveRuntime(state: RuntimeState): Promise<void> {
  await chrome.storage.session.set({ session: state.session, focused: state.focused, idle: state.idle });
}
