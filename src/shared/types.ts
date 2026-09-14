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

/**
 * One continuous stretch of attention on a single URL, with wall-clock bounds.
 *
 * Unlike `UsageDay`, this is recorded for every trackable page, not only pages a rule covers,
 * which is what makes the activity history able to answer "where did the day go?".
 */
export interface ActivitySegment {
  url: string;
  host: string;
  startedAt: number;
  endedAt: number;
}

/** Every segment recorded on one local calendar date. */
export interface ActivityDay {
  date: string;
  segments: ActivitySegment[];
}

/** Durable data persisted in chrome.storage.local. */
export interface StoredData {
  rules: Rule[];
  usage: UsageDay;
}

/**
 * The three states chrome.idle reports. Stored verbatim rather than reduced to "away", because
 * a locked screen and a merely quiet keyboard call for different decisions.
 */
export type Presence = 'active' | 'idle' | 'locked';

/** Volatile runtime state persisted in chrome.storage.session. */
export interface RuntimeState {
  session: Session | null;
  focused: boolean;
  presence: Presence;
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

/** One minute of the day, with the host that dominated it. Only active minutes are sent. */
export interface MinuteSlot {
  minute: number;
  activeSeconds: number;
  host: string;
}

/** A host's share of a day, ready to be turned into a rule in one click. */
export interface HostTotal {
  host: string;
  url: string;
  seconds: number;
  visits: number;
  /** Fraction of the day's tracked time, 0..1. */
  share: number;
  /** Seconds per hour, 24 entries, for the row's sparkline. */
  hourly: number[];
  /** Regex that would match this host, pre-escaped for the rule form. */
  suggestedPattern: string;
  /** True when an existing rule already covers this host. */
  hasRule: boolean;
}

/** Everything the activity tab renders for one day. */
export interface ActivityView {
  date: string;
  minDate: string;
  maxDate: string;
  totalSeconds: number;
  /** Time spent on hosts an existing rule already covers. */
  coveredSeconds: number;
  hostCount: number;
  peakMinute: number | null;
  hourly: number[];
  minutes: MinuteSlot[];
  top: HostTotal[];
  datesWithData: string[];
}
