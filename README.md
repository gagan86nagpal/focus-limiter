# Focus Limiter

A Chrome extension (Manifest V3) that does two things: it shows you **where your
day actually went**, and it enforces **daily time limits** on the sites you pick.
When a site's budget runs out, the tab is redirected to a calm "limit reached"
page where you can extend the limit or head back.

Everything is measured and stored locally. Nothing is uploaded anywhere, and the
extension asks for no network permissions at all.

The npm package / repository is named **`chrome-site-blocker`**; the product is
**Focus Limiter**.

## Try it without installing

**[gagan86nagpal.github.io/focus-limiter](https://gagan86nagpal.github.io/focus-limiter/)**

That is the real dashboard, not a slideshow of it. The demo replaces one thing —
the transport that normally carries a message to the service worker — with an
in-memory Chrome, so the page runs the extension's own tracker, validation and
activity maths against a generated month of browsing. Switch tabs, hover the
day strip, pin a site, create a rule, walk back through the history.

Because it is the shipped code rather than a copy of it, the demo cannot drift
from the extension; if the dashboard changes, the demo changes with it or the
build fails.

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

Every screen below is the real extension, photographed in dark mode by
`npm run screenshots`. The light theme is the same layout on a white ground.

### Where the day went

The **Activity** tab opens on today. Four figures summarise it: time actually
spent looking at pages, how many sites that was spread across, the busiest
minute, and how much of the day is already under a limit you set.

Underneath is the day itself — a 24-hour strip where each block is an unbroken
stretch on one site, coloured to match the list below. Empty stretches are time
the browser was not in front of you.

![Activity tab](docs/screenshots/activity-dark.png)

### Reading the strip

Move along the strip and it tells you what you were doing at that minute. The
tooltip names the site and how much of that minute went to it, and the matching
row and legend chip light up at the same time, so "what is that orange block at
eleven?" is answered without clicking anything.

![Hovering the day strip](docs/screenshots/activity-hover-dark.png)

### Following one site

Click a legend chip to pin a site. Everything else in the chart drops back and
the day becomes that one site's day: when you went to it, how often, and how
long you stayed. Click the chip again to release it.

![Focusing one site](docs/screenshots/activity-focus-dark.png)

### Turning a habit into a limit

The top-sites list is ranked by time, with a sparkline showing which hours each
site claimed. Any site you have not already limited carries a minute field and a
**Block** button — the pattern is worked out for you, so noticing a problem and
doing something about it is one click apart.

Once the rule exists the row switches to **Limited**, the under-a-limit figure
goes up, and the rules tab has a matching card waiting.

![Blocking a site from the activity list](docs/screenshots/activity-block-dark.png)

### Looking back

**‹** and **›** step through the last 30 days, the date field jumps straight to
a day, and **Today** comes back. Days outside the window are simply not
selectable, so there is nowhere to navigate to that holds nothing.

![Yesterday's activity](docs/screenshots/activity-history-dark.png)

### Managing rules

The **Rules** tab is the other half. Each card shows today's usage against its
budget; the bar fills as the day goes on and turns red when the limit is
reached.

![Rules tab](docs/screenshots/rules-dark.png)

### Writing a rule

Rules are regular expressions, which sounds unfriendly until you see the form.
Pick a common site to fill it in, or type your own and paste a URL to check it
matches — the verdict updates as you type, before anything is saved.

![Creating a rule](docs/screenshots/rule-dialog-dark.png)

Deleting asks first, in place, rather than throwing up a modal.

![Confirming a delete](docs/screenshots/rule-delete-dark.png)

### Hitting the limit

When the budget runs out the tab is replaced with the reason: which rule caught
it, and the usage against the limit. **Continue** is deliberately dead while the
limit stands — there is no way to wave the page away without deciding to spend
more time.

![Limit reached](docs/screenshots/blocked-dark.png)

### Deciding to spend more

If you do want more, +5 and +10 are one click, or type any number of minutes.
The limit changes, **Continue** wakes up, and it takes you back to the page you
were on. Tracking picks up where it left off.

![Limit extended](docs/screenshots/blocked-extended-dark.png)

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
  demo/            Faked Chrome, generated fixtures, and entry point for the Pages demo
tests/
  unit/            Vitest unit tests (100% coverage)
  e2e/             Playwright end-to-end tests (real Chromium + extension)
  helpers/         Chrome API mock, jsdom setup, DOM loader
scripts/
  gen-icons.mjs    Dependency-free PNG icon generator
  screenshots.mjs  Regenerates the product screenshots in this README
  diagrams.mjs     Regenerates the architecture diagrams
  build-demo.mjs   Builds the Pages demo from the dashboard's own markup
docs/
  screenshots/     Product screenshots
  architecture/    Swimlane diagrams
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

## Running the demo locally

```bash
npm run demo         # build the static demo into dist-demo/
npm run demo:serve   # build it, then serve it on http://localhost:4173
```

`dist-demo/index.html` is generated from `public/dashboard.html` rather than
copied, and the build fails loudly if the markup it edits has moved — which is
what stops the demo and the dashboard from diverging in silence.

Pushing to `main` publishes it, but only after `npx playwright test demo` passes
against the built output, so a demo that does not work is never deployed.

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
