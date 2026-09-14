/** A user-defined rule: a URL regex plus a daily time budget in minutes. */
export interface Rule {
  id: string;
  pattern: string;
  limitMinutes: number;
  createdAt: number;
}

/** Input accepted from the rule form. */
export interface RuleInput {
  pattern: string;
  limitMinutes: number;
}

/** Per-day usage, keyed by rule id, in seconds. */
export interface UsageDay {
  date: string;
  seconds: Record<string, number>;
}

/** An active tracking session on the currently focused tab. */
export interface Session {
  tabId: number;
  url: string;
  ruleIds: string[];
  startedAt: number;
}

/** Durable data persisted in chrome.storage.local. */
export interface StoredData {
  rules: Rule[];
  usage: UsageDay;
}

/** Volatile runtime state persisted in chrome.storage.session. */
export interface RuntimeState {
  session: Session | null;
  focused: boolean;
  idle: boolean;
}

/** A rule decorated with today's usage, as shown in the UI. */
export interface RuleView extends Rule {
  usedSeconds: number;
  limitReached: boolean;
}

export interface StateView {
  rules: RuleView[];
  maxRules: number;
}
