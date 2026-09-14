# Architecture

Focus Limiter is a Manifest V3 Chrome extension with three runtime surfaces that
share a small set of typed data structures. This document lists the domain
entities, the data-transfer objects (DTOs) exchanged between surfaces, the
storage layout, and the user flows.

## Components

| Component | Location | Role |
|-----------|----------|------|
| Background service worker | `src/background/` | Owns all state, tracks time, enforces limits |
| Dashboard (options page) | `src/dashboard/` | Create, edit, delete rules; view usage |
| Blocked page | `src/blocked/` | Shown when a limit is reached; extend and continue |
| Shared core | `src/shared/` | Types, DTOs, validation, time formatting, messaging |

The two UI surfaces never touch storage directly. They call the background
worker over `chrome.runtime` messages, and the worker is the single writer of
all persisted state.

## Entities (domain model)

Defined in `src/shared/types.ts`.

### Rule
The core entity. One URL pattern with a daily budget.

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | UUID, assigned by the worker on creation |
| `pattern` | `string` | JavaScript regular expression, matched against the tab URL |
| `limitMinutes` | `number` | Daily budget, 1–1440 |
| `createdAt` | `number` | Epoch milliseconds |

### UsageDay
Today's accumulated usage, one entry per rule, in seconds.

| Field | Type | Notes |
|-------|------|-------|
| `date` | `string` | Local calendar day, `YYYY-MM-DD`; a change here is the daily reset |
| `seconds` | `Record<string, number>` | Keyed by rule id |

### Session
The single active tracking session on the focused tab. Volatile.

| Field | Type | Notes |
|-------|------|-------|
| `tabId` | `number` | The tab being tracked |
| `url` | `string` | The URL at session start |
| `ruleIds` | `string[]` | Every rule that matches this URL |
| `startedAt` | `number` | Epoch milliseconds |

### RuntimeState
Volatile runtime flags, held in session storage.

| Field | Type | Notes |
|-------|------|-------|
| `session` | `Session \| null` | Null when nothing is being tracked |
| `focused` | `boolean` | Whether a browser window is focused |
| `idle` | `boolean` | Whether the user is idle/locked |

## DTOs

### View DTOs (worker → UI)
Defined in `src/shared/types.ts`. These decorate entities with computed fields so
the UI never recomputes usage math.

- **`RuleView`** = `Rule` + `usedSeconds: number` + `limitReached: boolean`.
  A rule with today's live usage folded in (stored seconds plus the current
  session's elapsed time).
- **`StateView`** = `{ rules: RuleView[]; maxRules: number }`.
  The whole dashboard state in one payload.

### Message DTOs (UI → worker)
Defined in `src/shared/messages.ts`. A discriminated union on `type`.

| Message | Payload | Response |
|---------|---------|----------|
| `getState` | — | `StateView` |
| `createRule` | `input: { pattern, limitMinutes }` | `RuleResult` |
| `updateRule` | `id`, `input` | `RuleResult` |
| `deleteRule` | `id` | `{ ok: true }` |
| `extendLimit` | `id`, `minutes` | `RuleViewResult` |

### Result DTOs (worker → UI)
- **`RuleResult`** = `{ ok: true; rule: Rule }` or
  `{ ok: false; error: string; errors?: { pattern?, limitMinutes? } }`.
- **`RuleViewResult`** = `{ ok: true; rule: RuleView }` or `{ ok: false; error }`.

Field-level errors (`errors`) drive inline form validation; `error` alone drives
a general form-level message.

### Validation DTO
`validateRuleInput()` in `src/shared/rules.ts` returns a `ValidationResult`:
`{ ok: true; value: RuleInput }` or `{ ok: false; errors; message }`. It is the
single validation path, used by both the dashboard form and the worker.

### Reference data
`SITE_PRESETS` in `src/shared/presets.ts` is a static list of common time-sink
sites, each a `SitePreset` (`id`, `label`, `pattern`, `limitMinutes`). It powers
the "Common sites" quick-add chips in the rule dialog and is not persisted.

## Storage layout

| Store | Keys | Contents | Lifetime |
|-------|------|----------|----------|
| `chrome.storage.local` | `rules`, `usage` | `Rule[]`, `UsageDay` | Durable |
| `chrome.storage.session` | `session`, `focused`, `idle` | `RuntimeState` | Cleared on browser restart |

On read, usage from a previous calendar day is discarded and replaced with an
empty `UsageDay` — that is the daily reset. All writes go through the worker's
serialized queue, so overlapping Chrome events cannot corrupt state.

## The reconcile step

Every meaningful Chrome event (tab activated, URL changed, tab removed, window
focus changed, idle state changed, alarm fired) triggers one serialized
`reconcile`:

1. Fold the previous session's elapsed time into `UsageDay`.
2. Inspect the focused, non-idle tab.
   - If a matching rule is already exhausted, redirect the tab to `blocked.html`.
   - Else if any rule matches, start a `Session` with a deadline at the smallest
     remaining budget, and arm an alarm plus a 1-second ticker.
   - Else clear the session.

## User flows

### 1. Create a rule
Dashboard → **Add rule** → optionally click a **Common sites** chip to fill the
pattern and a suggested limit from `SITE_PRESETS`, or enter them by hand (live
regex validation and
optional test-URL match feedback) → **Save rule** → `createRule` → worker
validates, enforces the 10-rule cap, assigns a UUID, persists, reconciles → the
new card appears.

### 2. Edit or delete a rule
**Edit** reopens the dialog prefilled and sends `updateRule`. **Delete** asks for
inline confirmation, then sends `deleteRule`, which also drops that rule's usage.

### 3. Track and enforce
The user browses. On each tab/focus event the worker reconciles, accruing time on
the active tab. When the deadline passes (via the alarm or the ticker), the tab
is redirected to `blocked.html?rule=<id>&url=<original>`.

### 4. Hit a limit
`blocked.html` reads the rule id and original URL from its query string, calls
`getState`, and shows the rule, usage vs limit, and why it was blocked. Continue
is disabled while the limit stands.

### 5. Extend and continue
**+5 min** / **+10 min** send `extendLimit`; the worker raises `limitMinutes`
(capped at 1440) and returns a fresh `RuleView`. The page re-enables **Continue**,
which navigates back to the original URL. The now-under-limit tab is not
re-blocked.

### 6. Reach the maximum
At 10 rules the dashboard disables **Add rule** and shows a notice; the worker
independently rejects an 11th `createRule` with an `error`.
