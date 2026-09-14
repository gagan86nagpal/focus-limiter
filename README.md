# Focus Limiter

A Chrome extension (Manifest V3) that does two things: it shows you **where your
day actually went**, and it enforces **daily time limits** on the sites you pick.
When a site's budget runs out, the tab is redirected to a calm "limit reached"
page where you can extend the limit or head back.

Everything is measured and stored locally. Nothing is uploaded anywhere, and the
extension asks for no network permissions at all.

The npm package / repository is named **`chrome-site-blocker`**; the product is
**Focus Limiter**.

## Try it in your browser

**[gagan86nagpal.github.io/focus-limiter](https://gagan86nagpal.github.io/focus-limiter/)**

The product page carries a working copy of the extension, and nothing to install
to use it. Its **Product demo** tab is the real dashboard *and* the real "limit
reached" page, running on a generated month of browsing: switch between rules and
activity, hover the day strip, pin a site, create a rule — then spend the YouTube
budget, take five more minutes, and watch the limit move on both screens at once.
The **Install** tab is the same four steps as [below](#install).

Only one thing is substituted: the transport that normally carries a message to
the service worker is replaced by an in-memory Chrome. Everything else is the
shipped code, so the page runs the extension's own tracker, validation, and
activity maths. That also means the demo cannot drift from the extension — the
page is assembled out of `public/dashboard.html` and `public/blocked.html` at
build time, and the build fails if that markup moves.

## Features

- **Activity tracking.** Every page you look at is recorded with a start and end
  time, drawn as a minute-by-minute strip of your day and ranked into a top-sites
  list. Thirty days of history, kept entirely on your machine.
- **Block what you just saw.** Any site in the list can become a rule in one
  click, without retyping a pattern.
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
- **Common-site presets.** One-click chips (YouTube Shorts, X, Instagram,
  Reddit, TikTok, Facebook) fill the pattern and a suggested limit.
- **Light and dark.** Follows the system theme, with a toggle that sticks.

## The product

The **Activity** tab records every page you look at and draws the day as a strip
you can read: hover it and it names the site you were on at that minute, with
the matching row and legend chip lighting up alongside.

![Activity tab](docs/screenshots/activity-dark.png)

Anything in the ranked list that is not already limited can become a rule in one
click — the pattern is worked out for you, and both tabs update.

![Blocking a site from the activity list](docs/screenshots/activity-block-dark.png)

When a budget runs out the tab is replaced with the reason, and **Continue**
stays dead until you decide to spend more time.

![Limit reached](docs/screenshots/blocked-dark.png)

**[See every flow in docs/PRODUCT.md →](docs/PRODUCT.md)** — the rules tab, the
rule form, focusing one site, 30-day history, and extending a limit, all in dark
mode.

## Project layout

```
public/            Static assets copied verbatim into dist/
  manifest.json    MV3 manifest
  dashboard.html   Options page (rules and activity tabs)
  blocked.html     The "limit reached" page
  styles.css       Shared design system
  icons/           Generated PNG icons
src/
  shared/          Types, time formatting, rule validation, activity maths, messaging, presets
  background/      Service worker: storage, the tracker core, event wiring
  dashboard/       Dashboard UI logic
  blocked/         Blocked-page UI logic
  demo/            The product site: faked Chrome, generated fixtures, page shell and copy
tests/
  unit/            Vitest unit tests (100% coverage)
  e2e/             Playwright end-to-end tests (real Chromium + extension)
  helpers/         Chrome API mock, jsdom setup, DOM loader
scripts/
  gen-icons.mjs    Dependency-free PNG icon generator
  screenshots.mjs  Regenerates the product screenshots in docs/PRODUCT.md
  diagrams.mjs     Regenerates the architecture diagrams
  demo-html.mjs    Assembles the site's page from the extension's own markup
  build-demo.mjs   Writes that page into dist-demo/ with its assets and bundle
docs/
  PRODUCT.md       Every user flow, with screenshots
  screenshots/     Product screenshots
  architecture/    Swimlane diagrams
build.mjs          esbuild bundler
```

## Install

Not on the Chrome Web Store yet, so it loads unpacked from a local build. These
steps are also on the site's
[Install tab](https://gagan86nagpal.github.io/focus-limiter/) if you would rather
read them there.

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

See [docs/PRODUCT.md](docs/PRODUCT.md) for a walkthrough of every screen, and
[ARCHITECTURE.md](ARCHITECTURE.md) for entities, DTOs, and user flows.

## How it works

The service worker keeps durable data (rules, today's usage, and the activity
history) in `chrome.storage.local` and volatile data (the active session, focus,
and idle flags) in `chrome.storage.session`. Every relevant Chrome event — tab
activation, URL change, window focus, idle state, and alarms — triggers a single
serialized `reconcile` step that:

1. Folds the previous session's elapsed time into today's usage.
2. Looks at the focused tab. If a matching rule is already exhausted, the tab is
   redirected to `blocked.html`. Otherwise a tracking session starts; if any
   rule matches, it carries a deadline at the smallest remaining budget.
3. Files the session that just ended into the activity history.

All background operations run through a promise queue, so overlapping events can
never corrupt stored usage.

A few decisions worth knowing about:

- **Sessions open for every page**, not only ones a rule covers, because the
  activity history needs the whole day. A page under no rule accrues no usage
  and arms no deadline.
- **Activity lives under its own storage key** and is written on its own. Page
  views are recorded constantly, and if they travelled with the rule list then
  every recorded view would risk undoing a rule you had just edited.
- **Old days are dropped as new ones are written**, not on a schedule. A
  Manifest V3 worker is asleep most of the time, so a cleanup timer would fire
  late or never; pruning on write means the history can only be trimmed at the
  moment it grows.
- **Adjacent views of the same URL merge.** Sitting on one page produces a
  reconcile every few seconds, and without merging the history would be
  thousands of one-second slivers instead of one honest visit.

## Regenerating the docs

```bash
npm run screenshots  # rebuild, then re-photograph every flow in dark mode
npm run diagrams     # re-render the swimlane diagrams
```

Both write into `docs/`, so a change to the UI or the architecture shows up as a
reviewable diff rather than a stale picture.

## Running the site locally

```bash
npm run demo         # build the static site into dist-demo/
npm run demo:serve   # build it, then serve it on http://localhost:4173
```

`dist-demo/index.html` is assembled, not written by hand: `scripts/demo-html.mjs`
lifts the dashboard out of `public/dashboard.html` and the limit-reached screen
out of `public/blocked.html`, and drops them into the page shell in
`src/demo/shell.html`. Every lift asserts the markup it depends on, so moving that
markup fails the build instead of publishing a page with a hole in it. The unit
tests assemble the same page, which is what keeps the site's wiring and its
published markup honest with each other.

Pushing to `main` publishes it, but only after `npx playwright test demo` passes
against the built output, so a site that does not work is never deployed.

## Testing

```bash
npm run test         # unit (with coverage) then e2e
npm run test:unit    # Vitest, enforces 100% coverage on all metrics
npm run test:e2e     # Playwright against a real Chromium + the built extension
                     # (also builds and exercises the Pages demo)
npm run typecheck    # tsc --noEmit
```

Unit tests mock the `chrome.*` APIs and run the UI under jsdom. Coverage
thresholds are set to 100% for statements, branches, functions, and lines.

End-to-end tests load the built extension into a headless Chromium via a
persistent context and drive the real dashboard, both tabs, the blocked page,
and — using a throwaway local HTTP server — the actual redirect enforcement.

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
