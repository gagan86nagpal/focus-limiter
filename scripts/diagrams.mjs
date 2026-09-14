/**
 * Renders the architecture diagrams in docs/architecture.
 *
 * Every diagram is a set of swimlanes: a labelled lane per layer or journey, cards reading
 * left to right inside it, and an optional note about what crosses from one lane to the next.
 * Keeping them in code means a change to the system is a diff here rather than a redraw.
 *
 *   npm run diagrams
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/architecture');

const DIAGRAMS = [
  {
    name: 'system-architecture',
    title: 'System architecture',
    subtitle: 'Seven lanes, one direction of dependency — the UI never reaches storage',
    footnote: {
      label: 'Shared core',
      text: 'Entities, DTOs, validation, URL matching, activity maths, and time formatting live in src/shared and are the only vocabulary every lane agrees on.',
    },
    lanes: [
      {
        label: 'Presentation\nsurfaces',
        peers: true,
        accent: 'violet',
        cards: [
          { title: 'Dashboard · Rules', badge: 'UI', lines: ['Rule list and usage', 'Create, edit, delete'] },
          {
            title: 'Dashboard · Activity',
            badge: 'UI',
            lines: ['Day strip and top sites', 'Block a site in one click'],
          },
          { title: 'Blocked page', badge: 'UI', lines: ['Limit reached screen', 'Extend and continue'] },
          {
            title: 'Chrome events',
            badge: 'INPUT',
            lines: ['tabs, windows, idle, alarms', 'Enter the worker directly'],
            accent: 'red',
          },
        ],
        flow: 'one typed request per user intent',
      },
      {
        label: 'Transport',
        accent: 'blue',
        cards: [
          {
            title: 'sendMessage()',
            badge: 'DTO',
            lines: ['getState · getActivity · createRule', 'updateRule · deleteRule · extendLimit'],
          },
        ],
        flow: 'routes on message type alone',
      },
      {
        label: 'Controller',
        accent: 'blue',
        cards: [{ title: 'handleMessage()', badge: 'CTRL', lines: ['Holds no state of its own'] }],
        flow: 'command',
      },
      {
        label: 'Domain\nservice',
        peers: true,
        accent: 'green',
        cards: [
          {
            title: 'Tracker',
            badge: 'DOMAIN',
            lines: ['Usage accounting and enforcement', 'Serialized work queue — one writer at a time'],
          },
          {
            title: 'reconcile()',
            badge: 'STEP',
            lines: ['Settle usage, record the segment,', 'then block or start a session'],
          },
          { title: 'readActivity()', badge: 'STEP', lines: ['Folds the live session in', 'so the chart reaches now'] },
        ],
        flow: 'state i/o',
      },
      {
        label: 'Repository',
        peers: true,
        accent: 'amber',
        cards: [
          { title: 'store.ts · rules', badge: 'REPO', lines: ['loadData / saveData / saveUsage'] },
          { title: 'store.ts · activity', badge: 'REPO', lines: ['loadActivity / saveActivity'] },
        ],
        flow: 'persist — each key written on its own',
      },
      {
        label: 'Platform\nstorage',
        peers: true,
        accent: 'red',
        cards: [
          { title: 'storage.local', badge: 'DATA', lines: ['rules · usage · activity', 'Durable across restarts'] },
          { title: 'storage.session', badge: 'DATA', lines: ['session, focused, idle', 'Cleared on restart'] },
        ],
      },
    ],
  },
  {
    name: 'request-lifecycle',
    title: 'Request lifecycle',
    subtitle: 'One "Block" click in the activity tab, traced down through every lane and back',
    footnote: {
      label: 'Why the round trip',
      text: 'The panel never writes storage and never computes usage. It asks, the worker decides, and the answer comes back as a DTO — so the rules tab and the activity tab can never disagree.',
    },
    lanes: [
      {
        label: '1. Intent',
        accent: 'violet',
        cards: [
          { title: 'User clicks Block', badge: 'UI', lines: ['On the figma.com row', '25 minutes in the field'] },
          { title: 'Panel validates', badge: 'UI', lines: ['Integer, 1 to 1440', 'Bad input never leaves the page'] },
          {
            title: 'suggestedPattern',
            badge: 'DTO',
            lines: ['figma\\.com — escaped by the', 'worker, not the page'],
          },
        ],
        flow: 'createRule message',
      },
      {
        label: '2. Transport',
        accent: 'blue',
        cards: [
          { title: 'sendMessage()', badge: 'DTO', lines: ['{ type, input }', 'One shape, typed both ends'] },
          { title: 'handleMessage()', badge: 'CTRL', lines: ['Switch on type', 'Calls tracker.createRule'] },
        ],
        flow: 'enqueued behind any in-flight write',
      },
      {
        label: '3. Domain',
        accent: 'green',
        cards: [
          { title: 'Rule cap', badge: 'GUARD', lines: ['At most 10 rules'] },
          { title: 'Validate', badge: 'GUARD', lines: ['Pattern compiles', 'Limit in range'] },
          { title: 'Persist', badge: 'WRITE', lines: ['saveData — rules only'] },
          { title: 'reconcile()', badge: 'STEP', lines: ['The open tab is re-matched', 'against the new rule at once'] },
        ],
        flow: 'RuleResult',
      },
      {
        label: '4. Answer',
        accent: 'amber',
        cards: [
          { title: '{ ok: true, rule }', badge: 'RESULT', lines: ['Or ok: false with the reason'] },
          { title: 'Panel reloads the day', badge: 'UI', lines: ['getActivity for the same date'] },
          { title: 'Row flips to Limited', badge: 'UI', lines: ['hasRule is now true', 'Under-a-limit share goes up'] },
        ],
        flow: 'onRulesChanged',
      },
      {
        label: '5. Other tab',
        accent: 'red',
        cards: [
          {
            title: 'Rules tab refreshes',
            badge: 'UI',
            lines: ['getState — the new card is there', 'when the user switches back'],
          },
        ],
      },
    ],
  },
  {
    name: 'activity-pipeline',
    title: 'Activity pipeline',
    subtitle: 'How a page you looked at becomes a chart you can read',
    footnote: {
      label: 'No timers',
      text: 'Nothing here runs on a schedule. A segment is filed when a view ends and old days are dropped in the same write, so a sleeping worker can never leave stale history behind.',
    },
    lanes: [
      {
        label: 'Capture',
        peers: true,
        accent: 'violet',
        cards: [
          {
            title: 'Session',
            badge: 'ENTITY',
            lines: ['tabId, url, ruleIds, startedAt', 'Opened for any trackable page'],
          },
          {
            title: 'ruleIds may be empty',
            badge: 'NOTE',
            lines: ['A page under no rule accrues no', 'usage but is still recorded'],
          },
        ],
        flow: 'the view ends — tab switch, blur, idle, or heartbeat',
      },
      {
        label: 'Record',
        accent: 'blue',
        cards: [
          { title: 'sessionSegment()', badge: 'PURE', lines: ['Session + now → ActivitySegment'] },
          { title: 'isRecordable()', badge: 'GUARD', lines: ['Under one second is a glance,', 'not a visit — dropped'] },
          { title: 'splitByDay()', badge: 'PURE', lines: ['A view across midnight becomes', 'one segment per day'] },
          { title: 'appendSegment()', badge: 'PURE', lines: ['Same URL within 2s extends the', 'last segment instead of adding one'] },
        ],
        flow: 'same write',
      },
      {
        label: 'Retain',
        accent: 'amber',
        cards: [
          { title: 'pruneDays()', badge: 'PURE', lines: ['Drops days outside the 30-day window'] },
          { title: 'saveActivity()', badge: 'WRITE', lines: ['Its own storage key, written alone,', 'so a rule edit is never clobbered'] },
        ],
        flow: 'the activity tab is opened',
      },
      {
        label: 'Read',
        accent: 'green',
        cards: [
          { title: 'readActivity(date)', badge: 'STEP', lines: ['Stored days + the live session'] },
          { title: 'toMinuteSlots()', badge: 'PURE', lines: ['Only active minutes, each labelled', 'with the site that dominated it'] },
          { title: 'toHostTotals()', badge: 'PURE', lines: ['Seconds, visits, share, and a', '24-hour profile per site'] },
        ],
        flow: 'ActivityView',
      },
      {
        label: 'Present',
        peers: true,
        accent: 'red',
        cards: [
          { title: 'Day strip', badge: 'UI', lines: ['Adjacent minutes on one site', 'merge into a single block'] },
          { title: 'Top sites', badge: 'UI', lines: ['Ranked, with sparklines', 'and a Block button'] },
          { title: 'Cross-highlight', badge: 'UI', lines: ['Chart, legend, and list all', 'answer to the same host'] },
        ],
      },
    ],
  },
  {
    name: 'domain-entities-and-dtos',
    title: 'Domain entities and DTOs',
    subtitle: 'What is stored, what is volatile, and what crosses the UI boundary',
    footnote: {
      label: 'One rule',
      text: 'Entities are written; view DTOs are computed on read and never persisted. Nothing derived is ever stored, so there is nothing to invalidate.',
    },
    lanes: [
      {
        label: 'Persisted\nentities',
        peers: true,
        accent: 'blue',
        cards: [
          { title: 'Rule', badge: 'ENTITY', lines: ['id, pattern', 'limitMinutes, createdAt'] },
          { title: 'UsageDay', badge: 'ENTITY', lines: ['date: YYYY-MM-DD', 'seconds: ruleId to secs'] },
          { title: 'ActivitySegment', badge: 'ENTITY', lines: ['url, host', 'startedAt, endedAt'] },
          { title: 'ActivityDay', badge: 'ENTITY', lines: ['date, segments[]', 'One per day, 30 kept'] },
        ],
        flow: 'stored under',
      },
      {
        label: 'Storage\nkeys',
        peers: true,
        accent: 'amber',
        cards: [
          { title: 'StoredData', badge: 'DURABLE', lines: ['rules: Rule[] · usage: UsageDay'] },
          { title: 'activity', badge: 'DURABLE', lines: ['ActivityDay[] — its own key'] },
          {
            title: 'Written separately',
            badge: 'NOTE',
            lines: ['Recording a page view rewrites neither', 'rules nor usage, so edits survive'],
          },
        ],
        flow: 'decorated into',
      },
      {
        label: 'View DTOs\nworker to UI',
        peers: true,
        accent: 'green',
        cards: [
          { title: 'RuleView', badge: 'VIEW', lines: ['Rule + usedSeconds', '+ limitReached'] },
          { title: 'StateView', badge: 'VIEW', lines: ['rules: RuleView[]', 'maxRules'] },
          { title: 'MinuteSlot', badge: 'VIEW', lines: ['minute, activeSeconds, host', 'Active minutes only'] },
          { title: 'HostTotal', badge: 'VIEW', lines: ['seconds, visits, share, hourly[]', 'suggestedPattern, hasRule'] },
          { title: 'ActivityView', badge: 'VIEW', lines: ['The whole day: totals, minutes[],', 'top[], and the date range'] },
        ],
        flow: 'never written back',
      },
      {
        label: 'Volatile\nruntime',
        peers: true,
        accent: 'violet',
        cards: [
          { title: 'Session', badge: 'ENTITY', lines: ['tabId, url', 'ruleIds, startedAt'] },
          { title: 'RuntimeState', badge: 'AGGREGATE', lines: ['session: Session | null', 'focused, idle'] },
          {
            title: 'storage.session',
            badge: 'NOTE',
            lines: ['Survives worker restarts,', 'resets when the browser closes'],
          },
        ],
        flow: 'requested by',
      },
      {
        label: 'Message and\nresult DTOs',
        peers: true,
        accent: 'red',
        cards: [
          {
            title: 'Message',
            badge: 'REQUEST',
            lines: ['getState, getActivity, createRule,', 'updateRule, deleteRule, extendLimit'],
          },
          { title: 'RuleInput', badge: 'INPUT', lines: ['pattern, limitMinutes', 'The validated form shape'] },
          {
            title: 'Result DTOs',
            badge: 'RESPONSE',
            lines: ['ok: true with data, or', 'ok: false with per-field errors'],
          },
        ],
      },
    ],
  },
  {
    name: 'user-flows',
    title: 'User flows',
    subtitle: 'The six journeys a person actually experiences',
    footnote: {
      label: 'Guardrails',
      text: 'At most 10 rules · at most 1440 minutes per day · only focused, active, non-idle time counts · activity is kept for 30 days and never leaves the browser.',
    },
    lanes: [
      {
        label: 'Create\na rule',
        accent: 'blue',
        cards: [
          { title: '1. Open dashboard', lines: ['Options page'] },
          { title: '2. Pick preset or regex', lines: ['Live validation'] },
          { title: '3. Set daily minutes', lines: ['1 to 1440'] },
          { title: '4. Save', lines: ['createRule'] },
          { title: '5. Rule is active', lines: ['Worker reconciles'] },
        ],
      },
      {
        label: 'Browse and\naccrue time',
        accent: 'green',
        cards: [
          { title: '1. Open a matching site', lines: ['Active tab'] },
          { title: '2. Session starts', lines: ['Focused, not idle'] },
          { title: '3. Time accrues', lines: ['Keyed by rule id'] },
          { title: '4. Switch or go idle', lines: ['Elapsed time settles'] },
          { title: '5. Midnight reset', lines: ['New local date'] },
        ],
      },
      {
        label: 'Reach\nthe limit',
        accent: 'red',
        cards: [
          { title: '1. Budget hits zero', lines: ['Alarm or 1s ticker'] },
          { title: '2. Worker reconciles', lines: ['Checks live usage'] },
          { title: '3. Tab is redirected', lines: ['blocked.html'] },
          { title: '4. Reason is shown', lines: ['Rule, usage, limit'] },
          { title: '5. Continue disabled', lines: ['Until limit grows'] },
        ],
      },
      {
        label: 'Extend and\ncontinue',
        accent: 'violet',
        cards: [
          { title: '1. Choose +5 or +10', lines: ['Quick presets'] },
          { title: '2. Or type any minutes', lines: ['1, 2, or more'] },
          { title: '3. Submit', lines: ['extendLimit'] },
          { title: '4. Fresh RuleView', lines: ['Limit increased'] },
          { title: '5. Back to the site', lines: ['Tracking resumes'] },
        ],
      },
      {
        label: 'See where\ntime went',
        accent: 'teal',
        cards: [
          { title: '1. Open Activity', lines: ['Loaded on first view'] },
          { title: '2. Read the day', lines: ['Total, sites, peak'] },
          { title: '3. Scan the strip', lines: ['Hover for site and time'] },
          { title: '4. Focus one site', lines: ['Click its legend chip'] },
          { title: '5. Step back a day', lines: ['Up to 30 days'] },
        ],
      },
      {
        label: 'Block from\nactivity',
        accent: 'amber',
        cards: [
          { title: '1. Spot a time sink', lines: ['Ranked top sites'] },
          { title: '2. Set the minutes', lines: ['Defaults to 10'] },
          { title: '3. Click Block', lines: ['Pattern is suggested'] },
          { title: '4. Row says Limited', lines: ['Rule exists now'] },
          { title: '5. Rules tab agrees', lines: ['Same rule, both tabs'] },
        ],
      },
    ],
  },
];

const ACCENTS = {
  blue: { line: '#2f6be4', tint: '#eef3fd', badge: '#2f6be4', badgeBg: '#e6eefc' },
  green: { line: '#12796f', tint: '#ecf6f4', badge: '#12796f', badgeBg: '#e1f1ee' },
  amber: { line: '#b4620a', tint: '#fdf3e8', badge: '#b4620a', badgeBg: '#fbeada' },
  red: { line: '#a34237', tint: '#fdeeec', badge: '#a34237', badgeBg: '#fbe3e0' },
  violet: { line: '#6b4fc7', tint: '#f2eefc', badge: '#6b4fc7', badgeBg: '#ece5fb' },
  teal: { line: '#0f6f8c', tint: '#eaf5f9', badge: '#0f6f8c', badgeBg: '#dceef5' },
};

const escape = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function cardHtml(card, laneAccent) {
  const accent = ACCENTS[card.accent ?? laneAccent];
  const badge =
    card.badge === undefined
      ? ''
      : `<span class="badge" style="color:${accent.badge};background:${accent.badgeBg}">${escape(card.badge)}</span>`;
  const lines = (card.lines ?? []).map((line) => `<p class="line">${escape(line)}</p>`).join('');
  return `<div class="card" style="border-left-color:${accent.line}">
    <div class="card-head"><h3>${escape(card.title)}</h3>${badge}</div>
    ${lines}
  </div>`;
}

function laneHtml(lane, isLast) {
  const accent = ACCENTS[lane.accent];
  // Arrows mean "then"; a lane of peers gets plain spacing so it does not read as a sequence.
  const separator = lane.peers === true ? '<div class="gap"></div>' : `<div class="arrow" style="color:${accent.line}"></div>`;
  const cards = lane.cards.map((card) => cardHtml(card, lane.accent)).join(separator);
  const flow =
    lane.flow === undefined || isLast
      ? ''
      : `<div class="flow"><span class="flow-pill" style="color:${accent.line};border-color:${accent.line}33">${escape(lane.flow)}</span></div>`;
  return `<div class="lane">
    <div class="lane-label" style="background:${accent.tint};border-left-color:${accent.line};color:${accent.line}">${escape(lane.label).replace(/\n/g, '<br>')}</div>
    <div class="lane-body">${cards}</div>
  </div>${flow}`;
}

function diagramHtml(diagram) {
  const lanes = diagram.lanes
    .map((lane, index) => laneHtml(lane, index === diagram.lanes.length - 1))
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 1180px; padding: 26px 28px 20px; background: #ffffff; color: #14171f;
      font: 400 13px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    h1 { font-size: 21px; letter-spacing: -0.02em; }
    .subtitle { margin-top: 4px; color: #6b7280; font-size: 12.5px; }
    .lanes { margin-top: 18px; border-top: 1px solid #e7e9ee; }
    .lane { display: flex; align-items: stretch; border-bottom: 1px solid #e7e9ee; }
    .lane-label {
      flex: 0 0 118px; padding: 16px 12px; border-left: 3px solid;
      font-size: 10px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase;
      display: flex; align-items: center;
    }
    .lane-body { flex: 1; display: flex; align-items: stretch; gap: 0; padding: 12px 14px; background: #fbfbfc; }
    .card {
      flex: 1; min-width: 0; padding: 10px 13px; border: 1px solid #e4e6ec; border-left-width: 3px;
      border-radius: 7px; background: #ffffff;
    }
    .card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 5px; }
    h3 { font-size: 12.5px; font-weight: 700; letter-spacing: -0.01em; }
    .badge {
      flex-shrink: 0; padding: 2px 6px; border-radius: 4px;
      font-size: 8.5px; font-weight: 700; letter-spacing: 0.06em;
    }
    .line { color: #5b6270; font-size: 11px; line-height: 1.5; }
    .gap { flex: 0 0 12px; }
    .arrow {
      flex: 0 0 26px; align-self: center; height: 1.5px; margin: 0 5px;
      background: currentColor; position: relative;
    }
    .arrow::after {
      content: ''; position: absolute; right: -1px; top: -3.25px;
      border: 4px solid transparent; border-left-color: currentColor;
    }
    .flow { display: flex; justify-content: center; padding: 0; margin: -7px 0; position: relative; z-index: 1; }
    .flow-pill {
      padding: 2px 9px; border: 1px solid; border-radius: 999px; background: #ffffff;
      font-size: 9.5px; font-weight: 600; letter-spacing: 0.02em;
    }
    footer { margin-top: 14px; display: flex; gap: 10px; font-size: 10.5px; color: #6b7280; }
    footer b { color: #14171f; white-space: nowrap; }
  </style></head><body>
    <h1>${escape(diagram.title)}</h1>
    <p class="subtitle">${escape(diagram.subtitle)}</p>
    <div class="lanes">${lanes}</div>
    <footer><b>${escape(diagram.footnote.label)}</b><span>${escape(diagram.footnote.text)}</span></footer>
  </body></html>`;
}

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 600 }, deviceScaleFactor: 2 });

console.log('Rendering architecture diagrams:');
for (const diagram of DIAGRAMS) {
  await page.setContent(diagramHtml(diagram), { waitUntil: 'load' });
  await page.screenshot({ path: path.join(outDir, `${diagram.name}.png`), fullPage: true });
  console.log(`  ${diagram.name}.png`);
}

await browser.close();
console.log(`\n${String(DIAGRAMS.length)} diagrams written to docs/architecture/`);
