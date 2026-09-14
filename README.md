# Focus Limiter

A Chrome extension (Manifest V3) that enforces **daily time limits** on sites you
choose with URL patterns. When a site's daily budget runs out, the tab is
redirected to a calm "limit reached" page where you can extend the limit or head
back. Built with a clean, Uber-inspired visual language under its own brand.

The npm package / repository is named **`chrome-site-blocker`**; the product is
**Focus Limiter**.

## Features

- **Pattern-based rules.** Each rule is a JavaScript regular expression matched
  against the page URL, plus a daily limit in minutes.
- **Accurate time tracking.** Time is counted only on the focused, active tab
  while the user is not idle. Usage resets at local midnight.
- **Precise enforcement.** A per-rule deadline alarm plus a lightweight ticker
  redirect the tab the moment the budget is exhausted.
- **Extend on the spot.** From the blocked page, add +5 or +10 minutes and
  continue straight back to where you were.
- **At most 10 rules**, enforced in both the UI and the background.
- **Live rule form.** Immediate regex validation and match testing against a
  sample URL.

## Project layout

```
public/            Static assets copied verbatim into dist/
  manifest.json    MV3 manifest
  dashboard.html   Options page (rule management)
  blocked.html     The "limit reached" page
  styles.css       Shared design system
  icons/           Generated PNG icons
src/
  shared/          Types, time formatting, rule validation, messaging
  background/      Service worker: storage, the tracker core, event wiring
  dashboard/       Dashboard UI logic
  blocked/         Blocked-page UI logic
tests/
  unit/            Vitest unit tests (100% coverage)
  e2e/             Playwright end-to-end tests (real Chromium + extension)
  helpers/         Chrome API mock, jsdom setup, DOM loader
scripts/
  gen-icons.mjs    Dependency-free PNG icon generator
build.mjs          esbuild bundler
```

## Install

```bash
git clone https://github.com/gagan86nagpal/focus-limiter.git
cd focus-limiter && npm install
npm run build
```

### Load it into Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the `dist/` directory.

Focus Limiter now appears in your extensions. Open its options page to add rules.
Run `npm run dev` to rebuild on change while developing.

See [ARCHITECTURE.md](ARCHITECTURE.md) for entities, DTOs, and user flows.

## How it works

The service worker keeps durable data (rules and today's usage) in
`chrome.storage.local` and volatile data (the active session, focus, and idle
flags) in `chrome.storage.session`. Every relevant Chrome event — tab
activation, URL change, window focus, idle state, and alarms — triggers a single
serialized `reconcile` step that:

1. Folds the previous session's elapsed time into today's usage.
2. Looks at the focused tab. If a matching rule is already exhausted, the tab is
   redirected to `blocked.html`. Otherwise, if any rule matches, a new tracking
   session starts with a deadline at the smallest remaining budget.

All background operations run through a promise queue, so overlapping events can
never corrupt stored usage.

## Testing

```bash
npm run test         # unit (with coverage) then e2e
npm run test:unit    # Vitest, enforces 100% coverage on all metrics
npm run test:e2e     # Playwright against a real Chromium + the built extension
npm run typecheck    # tsc --noEmit
```

Unit tests mock the `chrome.*` APIs and run the UI under jsdom. Coverage
thresholds are set to 100% for statements, branches, functions, and lines.

End-to-end tests load the built extension into a headless Chromium via a
persistent context and drive the real dashboard, blocked page, and — using a
throwaway local HTTP server — the actual redirect enforcement.

## Quality gates

Tests run at three layers, each with an escape hatch ("breakglass"):

| Layer | When | Runs | Breakglass |
|-------|------|------|------------|
| `pre-commit` hook | Every local commit | Type check + unit tests (100% coverage) | `git commit --no-verify` |
| `pre-push` hook | Every local push | Full suite: type check + unit + e2e | `git push --no-verify` |
| GitHub Actions CI | Every push / pull request to `main` | Full suite on a clean runner | Re-run, or an admin override |

The hooks live in `.githooks/` and are enabled automatically by the `prepare`
script on `npm install`. To enable them manually:

```bash
git config core.hooksPath .githooks
```

**Blocking merges on GitHub.** A commit is created locally, so GitHub cannot
reject the commit itself — the `pre-commit` hook does that. To make GitHub
*reject a merge* when tests fail, enable branch protection on `main` and mark the
CI check as required (Settings → Branches → Add rule → "Require status checks to
pass"). Repository admins can then bypass it as the breakglass.

## License

MIT
