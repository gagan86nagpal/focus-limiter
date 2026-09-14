import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPageBody } from '../../helpers/dom';
import {
  ACTIVITY_ERROR_TEXT,
  AXIS_TICKS,
  BLOCK_FAILED_TEXT,
  HOVER_HINT,
  HOVER_TOLERANCE_MINUTES,
  MIN_ZOOM_MINUTES,
  PALETTE_SIZE,
  WHOLE_DAY,
  ZOOMED_HINT,
  ZOOM_MINUTES,
  axisLabel,
  colourClass,
  createActivityPanel,
  dragWindow,
  gridStep,
  hoverTolerance,
  nearestSlot,
  toRuns,
} from '../../../src/dashboard/activity';
import { MINUTES_PER_DAY } from '../../../src/shared/activity';
import type { Message, ResponseFor } from '../../../src/shared/messages';
import type { ActivityView, HostTotal, MinuteSlot } from '../../../src/shared/types';

const NOW = new Date(2026, 8, 14, 12, 0, 0).getTime();

const host = (over: Partial<HostTotal> = {}): HostTotal => ({
  host: 'x.com',
  url: 'https://x.com/home',
  seconds: 600,
  visits: 3,
  share: 0.6,
  hourly: Array.from({ length: 24 }, (_unused, hour) => (hour === 9 ? 600 : 0)),
  suggestedPattern: 'x\\.com',
  hasRule: false,
  ...over,
});

const slot = (minute: number, hostName = 'x.com', activeSeconds = 60): MinuteSlot => ({
  minute,
  activeSeconds,
  host: hostName,
});

const view = (over: Partial<ActivityView> = {}): ActivityView => ({
  date: '2026-09-14',
  minDate: '2026-08-16',
  maxDate: '2026-09-14',
  totalSeconds: 1000,
  coveredSeconds: 250,
  hostCount: 2,
  peak: { hour: 9, seconds: 1800 },
  hourly: Array.from({ length: 24 }, (_unused, hour) => (hour === 9 ? 1800 : 0)),
  minutes: [slot(540), slot(541)],
  top: [host(), host({ host: 'y.com', url: 'https://y.com/', seconds: 400, share: 0.4 })],
  datesWithData: ['2026-09-14'],
  ...over,
});

function mount(responses: Partial<Record<Message['type'], unknown>> = {}) {
  const sent: Message[] = [];
  const send = vi.fn(async (message: Message) => {
    sent.push(message);
    const canned = responses[message.type];
    if (typeof canned === 'function') return (canned as (m: Message) => unknown)(message);
    if (canned !== undefined) return canned;
    if (message.type !== 'getActivity') return { ok: true };
    return view({ date: (message as Extract<Message, { type: 'getActivity' }>).date });
  }) as unknown as <M extends Message>(message: M) => Promise<ResponseFor<M>>;

  const onRulesChanged = vi.fn();
  const panel = createActivityPanel(document, { send, now: () => NOW, onRulesChanged });
  return { panel, send, sent, onRulesChanged };
}

const el = (id: string) => document.getElementById(id) as HTMLElement;
const rows = () => Array.from(document.querySelectorAll<HTMLLIElement>('.top-row'));
const bars = () => Array.from(document.querySelectorAll<SVGRectElement>('.tl-bar'));
const legendItems = () => Array.from(document.querySelectorAll<HTMLLIElement>('.legend-item'));

/** jsdom does no layout, so give the chart a box the pointer maths can use. */
function sizeChart(width = 1440): void {
  const chart = document.getElementById('activity-chart') as unknown as SVGSVGElement;
  chart.getBoundingClientRect = () => ({ left: 0, width, top: 0, height: 120 }) as DOMRect;
}

function moveOver(clientX: number): void {
  const chart = document.getElementById('activity-chart') as unknown as SVGSVGElement;
  chart.dispatchEvent(new MouseEvent('mousemove', { clientX, bubbles: true }));
}

function pressAt(clientX: number, button = 0): void {
  const chart = document.getElementById('activity-chart') as unknown as SVGSVGElement;
  chart.dispatchEvent(new MouseEvent('mousedown', { clientX, button, bubbles: true }));
}

/** The release is listened for on the document, so a stretch can end anywhere. */
function releaseAt(clientX: number): void {
  document.dispatchEvent(new MouseEvent('mouseup', { clientX, bubbles: true }));
}

function clickOver(clientX: number): void {
  pressAt(clientX);
  releaseAt(clientX);
}

/** Press, drag, release: the pointer maths works in pixels, which here are minutes. */
function stretchOver(fromX: number, toX: number): void {
  pressAt(fromX);
  moveOver(toX);
  releaseAt(toX);
}

const band = () => document.querySelector('.tl-band') as SVGRectElement;
const leaveChart = () => {
  const chart = document.getElementById('activity-chart') as unknown as SVGSVGElement;
  chart.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
};

const axisLabels = () =>
  Array.from(document.querySelectorAll('#activity-axis span')).map((s) => s.textContent);
const gridLines = () => Array.from(document.querySelectorAll('.tl-grid'));

describe('colourClass', () => {
  it('gives each of the leading hosts its own series colour', () => {
    expect(colourClass(0)).toBe('tl-0');
    expect(colourClass(PALETTE_SIZE - 1)).toBe(`tl-${PALETTE_SIZE - 1}`);
  });

  it('falls back to the neutral colour past the palette', () => {
    expect(colourClass(PALETTE_SIZE)).toBe('tl-other');
  });
});

describe('toRuns', () => {
  it('joins adjacent minutes on one site into a single stretch', () => {
    expect(toRuns([slot(10), slot(11), slot(12)])).toEqual([
      { start: 10, end: 13, host: 'x.com', activeSeconds: 60 },
    ]);
  });

  it('breaks a stretch when the site changes', () => {
    expect(toRuns([slot(10), slot(11, 'y.com')])).toEqual([
      { start: 10, end: 11, host: 'x.com', activeSeconds: 60 },
      { start: 11, end: 12, host: 'y.com', activeSeconds: 60 },
    ]);
  });

  it('breaks a stretch across a gap', () => {
    expect(toRuns([slot(10), slot(40)]).map((run) => run.start)).toEqual([10, 40]);
  });

  it('takes the fullest minute as the height of the stretch', () => {
    expect(toRuns([slot(10, 'x.com', 12), slot(11, 'x.com', 60)])[0]?.activeSeconds).toBe(60);
  });

  it('has nothing to draw for a quiet day', () => {
    expect(toRuns([])).toEqual([]);
  });
});

describe('nearestSlot', () => {
  it('finds the closest active minute within tolerance', () => {
    expect(nearestSlot([slot(100), slot(200)], 203)?.minute).toBe(200);
  });

  it('returns nothing over a quiet stretch', () => {
    expect(nearestSlot([slot(100)], 600)).toBeNull();
  });

  it('returns nothing when there is no activity at all', () => {
    expect(nearestSlot([], 600)).toBeNull();
  });
});

describe('activity panel', () => {
  beforeEach(() => {
    loadPageBody('dashboard.html');
  });

  it('requests today by default', async () => {
    const { panel, sent } = mount();
    await panel.load();
    expect(sent).toEqual([{ type: 'getActivity', date: '2026-09-14' }]);
    expect(panel.getDate()).toBe('2026-09-14');
  });

  it('renders the stat strip', async () => {
    const { panel } = mount();
    await panel.load();

    expect(el('activity-total').textContent).toBe('16m');
    expect(el('activity-total-sub').textContent).toBe('across 2 active minutes');
    expect(el('activity-sites').textContent).toBe('2');
    expect(el('activity-peak').textContent).toBe('09:00');
    expect(el('activity-peak-sub').textContent).toBe('30m of that hour');
    expect(el('activity-covered').textContent).toBe('25%');
    expect(el('activity-covered-sub').textContent).toBe('4m of tracked time');
    expect(el('activity-day-label').textContent).toBe('Today');
  });

  it('shows a resting state when the day is empty', async () => {
    const { panel } = mount({
      getActivity: view({ totalSeconds: 0, coveredSeconds: 0, hostCount: 0, peak: null, minutes: [], top: [] }),
    });
    await panel.load();

    expect(el('activity-total-sub').textContent).toBe('no activity yet');
    expect(el('activity-peak').textContent).toBe('—');
    expect(el('activity-peak-sub').textContent).toBe('busiest hour');
    expect(el('activity-covered').textContent).toBe('0%');
    expect(el('activity-empty').hidden).toBe(false);
    expect(el('activity-top-panel').hidden).toBe(true);
  });

  it('draws one block per stretch of browsing, plus hour gridlines', async () => {
    const { panel } = mount();
    await panel.load();

    // The two adjacent minutes on x.com are one stretch, so one block.
    expect(bars()).toHaveLength(1);
    expect(document.querySelectorAll('.tl-grid')).toHaveLength(23);
    expect(bars()[0]?.getAttribute('class')).toContain('tl-0');
    expect(bars()[0]?.dataset['host']).toBe('x.com');
  });

  it('widens a one-minute visit so it stays visible', async () => {
    const { panel } = mount({ getActivity: view({ minutes: [slot(540)] }) });
    await panel.load();
    expect(Number(bars()[0]?.getAttribute('width'))).toBeGreaterThan(1);
  });

  it('draws a partly-spent minute shorter than a full one', async () => {
    const { panel } = mount({
      getActivity: view({ minutes: [slot(100, 'x.com', 15), slot(500, 'y.com', 60)] }),
    });
    await panel.load();
    const [partial, full] = bars().map((bar) => Number(bar.getAttribute('height')));
    expect(partial).toBeLessThan(full as number);
  });

  it('renders a row per host with share, visits, and a sparkline', async () => {
    const { panel } = mount();
    await panel.load();

    const first = rows()[0] as HTMLLIElement;
    expect(first.querySelector('[data-field="host"]')?.textContent).toBe('x.com');
    expect(first.querySelector('[data-field="time"]')?.textContent).toBe('10m');
    expect(first.querySelector('[data-field="share"]')?.textContent).toBe('60% · 3 visits');
    expect(first.querySelectorAll('.spark-bar')).toHaveLength(1);
    expect(el('activity-top-meta').textContent).toBe('2 of 2');
  });

  it('uses the singular form for a single visit', async () => {
    const { panel } = mount({ getActivity: view({ top: [host({ visits: 1 })] }) });
    await panel.load();
    expect(rows()[0]?.querySelector('[data-field="share"]')?.textContent).toBe('60% · 1 visit');
  });

  it('swaps the block form for a pill once a rule covers the host', async () => {
    const { panel } = mount({ getActivity: view({ top: [host({ hasRule: true })] }) });
    await panel.load();

    const row = rows()[0] as HTMLLIElement;
    expect((row.querySelector('[data-field="has-rule"]') as HTMLElement).hidden).toBe(false);
    expect((row.querySelector('[data-field="block-form"]') as HTMLElement).hidden).toBe(true);
  });

  // ----- date navigation -----

  it('steps to the previous and next day', async () => {
    const { panel, sent } = mount();
    await panel.load();

    el('activity-prev').click();
    await vi.waitFor(() => expect(panel.getDate()).toBe('2026-09-13'));

    el('activity-next').click();
    await vi.waitFor(() => expect(panel.getDate()).toBe('2026-09-14'));
    expect(sent.map((message) => (message as { date?: string }).date)).toEqual([
      '2026-09-14',
      '2026-09-13',
      '2026-09-14',
    ]);
  });

  it('jumps back to today', async () => {
    const { panel } = mount();
    await panel.load('2026-09-10');
    el('activity-today').click();
    await vi.waitFor(() => expect(panel.getDate()).toBe('2026-09-14'));
  });

  it('disables navigation at the edges of the retention window', async () => {
    const { panel } = mount({ getActivity: view({ date: '2026-08-16' }) });
    await panel.load('2026-08-16');
    expect((el('activity-prev') as HTMLButtonElement).disabled).toBe(true);
    expect((el('activity-next') as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables next and today on the newest day', async () => {
    const { panel } = mount();
    await panel.load();
    expect((el('activity-next') as HTMLButtonElement).disabled).toBe(true);
    expect((el('activity-today') as HTMLButtonElement).disabled).toBe(true);
  });

  it('loads the day chosen in the date field', async () => {
    const { panel } = mount();
    await panel.load();
    const input = el('activity-date') as HTMLInputElement;
    input.value = '2026-09-01';
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(panel.getDate()).toBe('2026-09-01'));
  });

  it('ignores a cleared date field', async () => {
    const { panel, sent } = mount();
    await panel.load();
    const input = el('activity-date') as HTMLInputElement;
    input.value = '';
    input.dispatchEvent(new Event('change'));
    expect(sent).toHaveLength(1);
  });

  // ----- hover and highlighting -----

  it('shows a tooltip and crosshair over an active minute', async () => {
    const { panel } = mount();
    await panel.load();
    sizeChart();

    moveOver(540);

    expect(el('activity-tooltip').hidden).toBe(false);
    expect(el('activity-tooltip-time').textContent).toBe('09:00');
    expect(el('activity-tooltip-host').textContent).toBe('x.com');
    expect(el('activity-tooltip-dur').textContent).toBe('1m 00s');
    expect(el('activity-hint').textContent).toBe('09:00 · x.com');
    expect(document.querySelector('.tl-cursor')?.getAttribute('visibility')).toBe('visible');
  });

  it('dims other hosts while hovering the chart', async () => {
    const { panel } = mount({
      getActivity: view({ minutes: [slot(540, 'x.com'), slot(800, 'y.com')] }),
    });
    await panel.load();
    sizeChart();

    moveOver(540);

    const chart = el('activity-chart');
    expect(chart.classList.contains('is-dimmed')).toBe(true);
    expect(bars()[0]?.classList.contains('is-lit')).toBe(true);
    expect(bars()[1]?.classList.contains('is-lit')).toBe(false);
  });

  it('hides the tooltip over a quiet stretch and on leave', async () => {
    const { panel } = mount();
    await panel.load();
    sizeChart();

    moveOver(540);
    moveOver(1200);
    expect(el('activity-tooltip').hidden).toBe(true);
    expect(el('activity-hint').textContent).toBe(HOVER_HINT);

    moveOver(540);
    el('activity-chart').dispatchEvent(new MouseEvent('mouseleave'));
    expect(el('activity-tooltip').hidden).toBe(true);
    expect(el('activity-chart').classList.contains('is-dimmed')).toBe(false);
  });

  it('ignores pointer moves before the chart has been laid out', async () => {
    const { panel } = mount();
    await panel.load();
    sizeChart(0);

    moveOver(540);

    expect(el('activity-tooltip').hidden).toBe(true);
  });

  it('ignores pointer moves outside the chart bounds', async () => {
    const { panel } = mount();
    await panel.load();
    sizeChart();

    moveOver(-40);

    expect(el('activity-tooltip').hidden).toBe(true);
  });

  it('highlights a host when its row is hovered', async () => {
    const { panel } = mount();
    await panel.load();

    const first = rows()[0] as HTMLLIElement;
    first.dispatchEvent(new MouseEvent('mouseenter'));
    expect(first.classList.contains('is-lit')).toBe(true);
    expect(el('activity-chart').classList.contains('is-dimmed')).toBe(true);

    first.dispatchEvent(new MouseEvent('mouseleave'));
    expect(first.classList.contains('is-lit')).toBe(false);
  });

  it('pins a host from the legend and releases it on a second click', async () => {
    const { panel } = mount();
    await panel.load();

    const [first] = legendItems();
    first?.click();
    expect(first?.classList.contains('is-pinned')).toBe(true);
    expect(el('activity-chart').classList.contains('is-dimmed')).toBe(true);

    // Hovering elsewhere must not clear a pin.
    (rows()[1] as HTMLLIElement).dispatchEvent(new MouseEvent('mouseleave'));
    expect(el('activity-chart').classList.contains('is-dimmed')).toBe(true);

    first?.click();
    expect(first?.classList.contains('is-pinned')).toBe(false);
    expect(el('activity-chart').classList.contains('is-dimmed')).toBe(false);
  });

  it('highlights from the legend on hover', async () => {
    const { panel } = mount();
    await panel.load();

    const [first] = legendItems();
    first?.dispatchEvent(new MouseEvent('mouseenter'));
    expect(rows()[0]?.classList.contains('is-lit')).toBe(true);
    first?.dispatchEvent(new MouseEvent('mouseleave'));
    expect(rows()[0]?.classList.contains('is-lit')).toBe(false);
  });

  it('caps the legend at the palette size', async () => {
    const many = Array.from({ length: PALETTE_SIZE + 3 }, (_unused, index) =>
      host({ host: `s${index}.com`, url: `https://s${index}.com/` }),
    );
    const { panel } = mount({ getActivity: view({ top: many }) });
    await panel.load();
    expect(legendItems()).toHaveLength(PALETTE_SIZE);
  });

  it('keeps a pin across a reload while the host is still listed', async () => {
    const { panel } = mount();
    await panel.load();

    legendItems()[0]?.click();
    await panel.load();

    expect(legendItems()[0]?.classList.contains('is-pinned')).toBe(true);
    expect(el('activity-chart').classList.contains('is-dimmed')).toBe(true);
  });

  it('drops a pin when the host leaves the list', async () => {
    const send = vi.fn();
    const responses: ActivityView[] = [view(), view({ top: [host({ host: 'y.com' })] })];
    let call = 0;
    const panel = createActivityPanel(document, {
      send: (async (message: Message) => {
        void send(message);
        return message.type === 'getActivity' ? responses[call++] : { ok: true };
      }) as never,
      now: () => NOW,
    });

    await panel.load();
    legendItems()[0]?.click();
    expect(el('activity-chart').classList.contains('is-dimmed')).toBe(true);

    await panel.load();
    expect(el('activity-chart').classList.contains('is-dimmed')).toBe(false);
  });

  // ----- one-click block -----

  it('creates a rule from a row and refreshes both tabs', async () => {
    const { panel, sent, onRulesChanged } = mount();
    await panel.load();

    const row = rows()[0] as HTMLLIElement;
    (row.querySelector('[data-field="minutes"]') as HTMLInputElement).value = '25';
    (row.querySelector('[data-action="block"]') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(onRulesChanged).toHaveBeenCalled());
    expect(sent).toContainEqual({
      type: 'createRule',
      input: { pattern: 'x\\.com', limitMinutes: 25 },
    });
    // The day is reloaded so the row flips to "Limited".
    expect(sent.filter((message) => message.type === 'getActivity')).toHaveLength(2);
  });

  it('rejects a nonsense minute value without sending anything', async () => {
    const { panel, sent } = mount();
    await panel.load();

    const row = rows()[0] as HTMLLIElement;
    const minutes = row.querySelector('[data-field="minutes"]') as HTMLInputElement;
    minutes.value = '0';
    (row.querySelector('[data-action="block"]') as HTMLButtonElement).click();

    expect(minutes.getAttribute('aria-invalid')).toBe('true');
    expect(sent.filter((message) => message.type === 'createRule')).toHaveLength(0);
  });

  it('surfaces a rejection from the worker', async () => {
    const { panel } = mount({ createRule: { ok: false, error: 'You can have at most 10 rules' } });
    await panel.load();

    (rows()[0]?.querySelector('[data-action="block"]') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(el('activity-error').hidden).toBe(false));
    expect(el('activity-error').textContent).toBe('You can have at most 10 rules');
  });

  it('reports a failure when the block request throws', async () => {
    const panel = createActivityPanel(document, {
      send: (async (message: Message) => {
        if (message.type === 'createRule') throw new Error('offline');
        return view();
      }) as never,
      now: () => NOW,
    });
    await panel.load();

    (rows()[0]?.querySelector('[data-action="block"]') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(el('activity-error').textContent).toBe(BLOCK_FAILED_TEXT));
  });

  // ----- failure handling -----

  it('ignores pointer moves when no day is loaded', async () => {
    const panel = createActivityPanel(document, {
      send: (async () => {
        throw new Error('offline');
      }) as never,
      now: () => NOW,
    });
    await panel.load();
    sizeChart();

    moveOver(540);

    expect(el('activity-tooltip').hidden).toBe(true);
  });

  it('reports when the day cannot be loaded', async () => {
    const panel = createActivityPanel(document, {
      send: (async () => {
        throw new Error('offline');
      }) as never,
      now: () => NOW,
    });

    await panel.load();

    expect(el('activity-error').hidden).toBe(false);
    expect(el('activity-error').textContent).toBe(ACTIVITY_ERROR_TEXT);
    expect(rows()).toHaveLength(0);
  });

  it('throws a clear error when the markup is missing', () => {
    document.body.innerHTML = '<div></div>';
    expect(() => createActivityPanel(document, { send: (async () => view()) as never, now: () => NOW })).toThrow(
      'Missing element: #activity-date',
    );
  });
});

describe('chart window maths', () => {
  it('spaces gridlines by the hour across a day and by ten minutes when zoomed', () => {
    expect(gridStep(MINUTES_PER_DAY)).toBe(60);
    expect(gridStep(ZOOM_MINUTES)).toBe(10);
  });

  it('steps down to the minute for the narrowest windows', () => {
    expect(gridStep(10)).toBe(1);
    expect(gridStep(30)).toBe(5);
    expect(gridStep(300)).toBe(30);
  });

  describe('dragWindow', () => {
    it('takes the stretch as drawn, with the far end exclusive', () => {
      expect(dragWindow(540, 600, WHOLE_DAY)).toEqual({ start: 540, end: 600 });
    });

    it('reads a stretch drawn right to left the same way', () => {
      expect(dragWindow(600, 540, WHOLE_DAY)).toEqual({ start: 540, end: 600 });
    });

    it('widens a twitch around its middle instead of zooming to one minute', () => {
      const range = dragWindow(600, 601, WHOLE_DAY);
      expect(range.end - range.start).toBe(MIN_ZOOM_MINUTES);
      expect(range.start).toBe(598);
    });

    it('keeps a widened stretch on the day at either end', () => {
      expect(dragWindow(0, 1, WHOLE_DAY)).toEqual({ start: 0, end: MIN_ZOOM_MINUTES });
      expect(dragWindow(MINUTES_PER_DAY - 1, MINUTES_PER_DAY, WHOLE_DAY)).toEqual({
        start: MINUTES_PER_DAY - MIN_ZOOM_MINUTES,
        end: MINUTES_PER_DAY,
      });
    });

    it('cannot select wider than the window it was drawn on', () => {
      expect(dragWindow(0, MINUTES_PER_DAY, { start: 540, end: 600 })).toEqual({
        start: 540,
        end: 600,
      });
    });

    it('stays inside a window it is narrowing', () => {
      expect(dragWindow(555, 570, { start: 540, end: 600 })).toEqual({ start: 555, end: 570 });
    });
  });

  it('reads the end of the day as 24:00 rather than one minute short of it', () => {
    expect(axisLabel(0)).toBe('00:00');
    expect(axisLabel(540)).toBe('09:00');
    expect(axisLabel(MINUTES_PER_DAY)).toBe('24:00');
  });

  it('shrinks the hover tolerance with the window, never below a minute', () => {
    expect(hoverTolerance(MINUTES_PER_DAY)).toBe(HOVER_TOLERANCE_MINUTES);
    expect(hoverTolerance(ZOOM_MINUTES)).toBe(1);
  });

  it('honours a tolerance tighter than the default', () => {
    const slots = [slot(540)];
    expect(nearestSlot(slots, 545, 1)).toBeNull();
    expect(nearestSlot(slots, 545)).toEqual(slot(540));
  });
});

describe('zooming the day strip', () => {
  beforeEach(() => {
    loadPageBody('dashboard.html');
  });

  async function open() {
    const mounted = mount();
    await mounted.panel.load();
    sizeChart();
    return mounted;
  }

  it('opens on the whole day', async () => {
    await open();

    expect(el('activity-chart').getAttribute('viewBox')).toBe(`0 0 ${MINUTES_PER_DAY} 48`);
    expect(axisLabels()).toEqual(['00:00', '06:00', '12:00', '18:00', '24:00']);
    expect(el('activity-zoom-out').hidden).toBe(true);
    expect(el('activity-hint').textContent).toBe(HOVER_HINT);
    expect(el('activity-chart').classList.contains('is-zoomed')).toBe(false);
    // Hourly gridlines, with none drawn on the two edges.
    expect(gridLines()).toHaveLength(23);
  });

  it('zooms into the hour that was clicked', async () => {
    await open();

    clickOver(545);

    expect(el('activity-chart').getAttribute('viewBox')).toBe(`540 0 ${ZOOM_MINUTES} 48`);
    expect(el('activity-zoom-range').textContent).toBe('09:00–10:00');
    expect(el('activity-zoom-out').hidden).toBe(false);
    expect(el('activity-chart').classList.contains('is-zoomed')).toBe(true);
    expect(el('activity-hint').textContent).toBe(ZOOMED_HINT);
  });

  it('rescales the axis and the gridlines to the zoomed hour', async () => {
    await open();

    clickOver(545);

    expect(axisLabels()).toEqual(['09:00', '09:15', '09:30', '09:45', '10:00']);
    // Every ten minutes between the edges: 09:10 through 09:50.
    expect(gridLines()).toHaveLength(5);
    expect(gridLines().map((line) => line.getAttribute('x1'))).toEqual([
      '550',
      '560',
      '570',
      '580',
      '590',
    ]);
  });

  it('keeps bars on absolute clock time and stops padding them out', async () => {
    await open();
    // The seeded run is two minutes, below the day view's minimum drawn width.
    expect(bars()[0]?.getAttribute('x')).toBe('540');
    expect(bars()[0]?.getAttribute('width')).toBe('4');

    clickOver(545);

    expect(bars()[0]?.getAttribute('x')).toBe('540');
    expect(bars()[0]?.getAttribute('width')).toBe('2');
  });

  it('zooms to midnight for a click in the first hour', async () => {
    await open();

    clickOver(30);

    expect(el('activity-chart').getAttribute('viewBox')).toBe(`0 0 ${ZOOM_MINUTES} 48`);
    expect(el('activity-zoom-range').textContent).toBe('00:00–01:00');
  });

  it('reads the last hour of the day as ending at 24:00', async () => {
    await open();

    clickOver(MINUTES_PER_DAY - 1);

    expect(el('activity-zoom-range').textContent).toBe('23:00–24:00');
    expect(axisLabels()[AXIS_TICKS]).toBe('24:00');
  });

  it('does not zoom again once zoomed', async () => {
    await open();
    clickOver(545);

    clickOver(550);

    expect(el('activity-chart').getAttribute('viewBox')).toBe(`540 0 ${ZOOM_MINUTES} 48`);
  });

  it('ignores a click that lands outside the strip', async () => {
    await open();

    clickOver(MINUTES_PER_DAY + 40);

    expect(el('activity-chart').getAttribute('viewBox')).toBe(`0 0 ${MINUTES_PER_DAY} 48`);
    expect(el('activity-zoom-out').hidden).toBe(true);
  });

  it('goes back to the whole day from the chip', async () => {
    await open();
    clickOver(545);

    el('activity-zoom-out').dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(el('activity-chart').getAttribute('viewBox')).toBe(`0 0 ${MINUTES_PER_DAY} 48`);
    expect(axisLabels()).toEqual(['00:00', '06:00', '12:00', '18:00', '24:00']);
    expect(el('activity-zoom-out').hidden).toBe(true);
    expect(el('activity-zoom-range').textContent).toBe('');
    expect(el('activity-hint').textContent).toBe(HOVER_HINT);
  });

  it('drops the zoom when another day is loaded', async () => {
    const { panel } = await open();
    clickOver(545);

    await panel.load('2026-09-13');

    expect(el('activity-chart').getAttribute('viewBox')).toBe(`0 0 ${MINUTES_PER_DAY} 48`);
    expect(el('activity-zoom-out').hidden).toBe(true);
  });

  it('places the tooltip within the zoomed window, not the day', async () => {
    await open();
    moveOver(540);
    expect(el('activity-tooltip').style.left).toBe(`${(540 / MINUTES_PER_DAY) * 100}%`);

    clickOver(545);
    // 09:00 is the left edge of the 09:00-10:00 window.
    moveOver(0);

    expect(el('activity-tooltip').hidden).toBe(false);
    expect(el('activity-tooltip').style.left).toBe('0%');
  });

  it('zooms to the stretch that was drawn, not a fixed hour', async () => {
    await open();

    stretchOver(545, 682);

    // 09:05 to 11:22, which is no hour boundary at all.
    expect(el('activity-chart').getAttribute('viewBox')).toBe('545 0 137 48');
    expect(el('activity-zoom-range').textContent).toBe('09:05–11:22');
    expect(el('activity-zoom-out').hidden).toBe(false);
  });

  it('previews the stretch as it is drawn, and reads out how long it is', async () => {
    await open();
    pressAt(545);

    moveOver(725);

    expect(band().getAttribute('visibility')).toBe('visible');
    expect(band().getAttribute('x')).toBe('545');
    expect(band().getAttribute('width')).toBe('180');
    expect(el('activity-hint').textContent).toBe('09:05–12:05 · 3h 00m');
    expect(el('activity-chart').classList.contains('is-selecting')).toBe(true);

    releaseAt(725);

    // The preview gives way to the zoom it promised.
    expect(band().getAttribute('visibility')).toBe('hidden');
    expect(el('activity-chart').classList.contains('is-selecting')).toBe(false);
    expect(el('activity-chart').getAttribute('viewBox')).toBe('545 0 180 48');
  });

  it('reads a stretch drawn leftwards the same as one drawn rightwards', async () => {
    await open();

    stretchOver(682, 545);

    expect(el('activity-chart').getAttribute('viewBox')).toBe('545 0 137 48');
  });

  it('pins a stretch that runs off the end of the day to midnight', async () => {
    await open();

    stretchOver(1380, MINUTES_PER_DAY + 200);

    expect(el('activity-zoom-range').textContent).toBe('23:00–24:00');
    expect(el('activity-chart').getAttribute('viewBox')).toBe('1380 0 60 48');
  });

  it('narrows again when a stretch is drawn inside a zoomed window', async () => {
    await open();
    clickOver(545);
    expect(el('activity-chart').getAttribute('viewBox')).toBe(`540 0 ${ZOOM_MINUTES} 48`);

    // The chart still spans the full width, so a quarter across is now a quarter of the hour.
    stretchOver(360, 720);

    expect(el('activity-chart').getAttribute('viewBox')).toBe('555 0 15 48');
    expect(el('activity-zoom-range').textContent).toBe('09:15–09:30');
  });

  it('treats too small a movement as a click on the hour', async () => {
    await open();
    pressAt(545);

    moveOver(547);

    expect(band().getAttribute('visibility')).toBe('hidden');

    releaseAt(547);

    expect(el('activity-chart').getAttribute('viewBox')).toBe(`540 0 ${ZOOM_MINUTES} 48`);
  });

  it('zooms to the clicked hour from inside a wider stretch', async () => {
    await open();
    stretchOver(0, 300);

    clickOver(600);

    // 600 of 1440 pixels across a 00:00-05:00 window lands at 02:05, so the 02:00 hour.
    expect(el('activity-zoom-range').textContent).toBe('02:00–03:00');
  });

  it('keeps the stretch alive when the pointer leaves the strip', async () => {
    await open();
    pressAt(545);
    moveOver(725);

    leaveChart();

    expect(band().getAttribute('visibility')).toBe('visible');

    releaseAt(725);
    expect(el('activity-chart').getAttribute('viewBox')).toBe('545 0 180 48');
  });

  it('ignores a press that is not the primary button', async () => {
    await open();

    pressAt(545, 2);
    releaseAt(545);

    expect(el('activity-zoom-out').hidden).toBe(true);
  });

  it('ignores a press before the chart has been laid out', async () => {
    const { panel } = mount();
    await panel.load();

    pressAt(545);
    releaseAt(545);

    expect(el('activity-zoom-out').hidden).toBe(true);
  });

  it('ignores a release that follows no press', async () => {
    await open();

    releaseAt(545);

    expect(el('activity-zoom-out').hidden).toBe(true);
  });

  it('stops previewing if the chart loses its layout mid-stretch', async () => {
    await open();
    pressAt(545);
    sizeChart(0);

    moveOver(725);

    expect(band().getAttribute('visibility')).toBe('hidden');
  });

  it('will not name a minute that the zoom has pushed off screen', async () => {
    await open();
    clickOver(1145); // 19:00-20:00, well away from the seeded 09:00 activity.

    moveOver(30);

    expect(el('activity-tooltip').hidden).toBe(true);
  });
});
