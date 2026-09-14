# Focus Limiter

A Chrome extension (Manifest V3) that shows where your day actually went and enforces daily time
limits on the sites you pick. When a budget runs out the tab is redirected to a calm page where
you can take more minutes or head back. Everything is measured and stored locally, and the
extension asks for no network permissions at all.

**[Try it, and see how to install it → gagan86nagpal.github.io/focus-limiter](https://gagan86nagpal.github.io/focus-limiter/)**

That page is the product: a working copy of the dashboard and the limit-reached screen, plus the
install steps. The rest of this file is for working on the code. Every screen is catalogued in
[docs/PRODUCT.md](docs/PRODUCT.md), and the entities, DTOs and flows are in
[ARCHITECTURE.md](ARCHITECTURE.md).

> The npm package and repository are named `chrome-site-blocker`; the product is Focus Limiter.

## Getting started

```bash
git clone https://github.com/gagan86nagpal/focus-limiter.git
cd focus-limiter
npm install     # also points core.hooksPath at .githooks, via `prepare`
npm run build   # bundles the loadable extension into dist/
```

Then load it: `chrome://extensions` → **Developer mode** → **Load unpacked** → pick `dist/`.
Chrome reads that folder from disk, so a rebuild is picked up by the reload arrow on the
extension's card — no need to remove and re-add it.

`npm run dev` rebuilds on change.

| Command | What it does |
| --- | --- |
| `npm run build` | Bundle into `dist/` |
| `npm run dev` | Same, watching for changes |
| `npm test` | Unit tests with coverage, then e2e |
| `npm run test:unit` | Vitest under jsdom; fails below 100% coverage |
| `npm run test:unit:watch` | Vitest in watch mode |
| `npm run test:e2e` | Playwright against a real Chromium with the extension loaded |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run demo` | Build the public site into `dist-demo/` |
| `npm run demo:serve` | Build it and serve on `http://localhost:4173` |
| `npm run icons` | Regenerate the PNG icons |
| `npm run screenshots` | Re-photograph every flow in `docs/` |
| `npm run diagrams` | Re-render the architecture diagrams |

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
  demo/            The public site: faked Chrome, generated fixtures, page shell and copy
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

## How it works

The service worker keeps durable data (rules, today's usage, and the activity history) in
`chrome.storage.local` and volatile data (the active session, focus, and presence) in
`chrome.storage.session`. Every relevant Chrome event — tab activation, URL change, window
focus, idle state, and alarms — triggers a single serialized `reconcile` step that:

1. Folds the previous session's elapsed time into today's usage.
2. Looks at the focused tab. If a matching rule is already exhausted, the tab is redirected to
   `blocked.html`. Otherwise a tracking session starts; if any rule matches, it carries a
   deadline at the smallest remaining budget.
3. Files the session that just ended into the activity history.

All background operations run through a promise queue, so overlapping events can never corrupt
stored usage.

A few decisions worth knowing about:

- **Sessions open for every page**, not only ones a rule covers, because the activity history
  needs the whole day. A page under no rule accrues no usage and arms no deadline.
- **An idle machine does not always stop the clock.** `chrome.idle` reports no keyboard or mouse
  for 60 seconds, which is exactly what watching a video looks like. A locked screen always
  stops counting; an idle one only stops if the tab is silent.
- **Activity lives under its own storage key** and is written on its own. Page views are recorded
  constantly, and if they travelled with the rule list then every recorded view would risk
  undoing a rule you had just edited.
- **Old days are dropped as new ones are written**, not on a schedule. A Manifest V3 worker is
  asleep most of the time, so a cleanup timer would fire late or never; pruning on write means
  the history can only be trimmed at the moment it grows.
- **Adjacent views of the same URL merge.** Sitting on one page produces a reconcile every few
  seconds, and without merging the history would be thousands of one-second slivers instead of
  one honest visit.

## Testing

Unit tests mock the `chrome.*` APIs and run the UI under jsdom, with coverage thresholds set to
100% for statements, branches, functions, and lines.

End-to-end tests load the built extension into a headless Chromium via a persistent context and
drive the real dashboard, both tabs, the blocked page, and — using a throwaway local HTTP
server — the actual redirect enforcement. A second suite drives the built site in `dist-demo/`
as a plain website, with no extension loaded at all.

## Quality gates

Tests run at three layers, each with an escape hatch ("breakglass"):

| Layer | When | Runs | Breakglass |
|-------|------|------|------------|
| `pre-commit` hook | Every local commit | Type check + unit tests (100% coverage) | `git commit --no-verify` |
| `pre-push` hook | Every local push | Full suite: type check + unit + e2e | `git push --no-verify` |
| GitHub Actions CI | Every push / pull request to `main` | Full suite on a clean runner | Re-run, or an admin override |

The hooks live in `.githooks/` and are enabled automatically by the `prepare` script on
`npm install`. To enable them manually:

```bash
git config core.hooksPath .githooks
```

**Blocking merges on GitHub.** A commit is created locally, so GitHub cannot reject the commit
itself — the `pre-commit` hook does that. To make GitHub *reject a merge* when tests fail, enable
branch protection on `main` and mark the CI check as required (Settings → Branches → Add rule →
"Require status checks to pass"). Repository admins can then bypass it as the breakglass.

## The public site

`dist-demo/index.html` is assembled, not written by hand: `scripts/demo-html.mjs` lifts the
dashboard out of `public/dashboard.html` and the limit-reached screen out of
`public/blocked.html`, and drops them into the page shell in `src/demo/shell.html`. Only the
transport is substituted — `src/demo/chrome-stub.ts` stands in for `chrome.*`, so the page runs
the extension's own tracker, validation and activity maths against generated fixtures.

Every lift asserts the markup it depends on, so moving that markup fails the build instead of
publishing a page with a hole in it. The unit tests assemble the same page, which keeps the
site's wiring and its published markup honest with each other.

Pushing to `main` publishes it, but only after `npx playwright test demo` passes against the
built output, so a site that does not work is never deployed.

## License

MIT
