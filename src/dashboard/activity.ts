import type { Message, ResponseFor } from '../shared/messages';
import { HOURS_PER_DAY, MINUTES_PER_DAY } from '../shared/activity';
import { MAX_LIMIT_MINUTES, MIN_LIMIT_MINUTES } from '../shared/rules';
import {
  dateKey,
  dateStart,
  formatClock,
  formatCompact,
  formatDayLabel,
  formatUsage,
  shiftDays,
} from '../shared/time';
import type { ActivityView, HostTotal, MinuteSlot } from '../shared/types';

export interface ActivityDeps {
  send: <M extends Message>(message: M) => Promise<ResponseFor<M>>;
  now: () => number;
  /** Lets the rules tab refresh after a rule is created from the top-sites list. */
  onRulesChanged?: () => void;
}

export const ACTIVITY_ERROR_TEXT = "Couldn't load activity. Please try again.";
export const BLOCK_FAILED_TEXT = "Couldn't create that rule. Please try again.";
export const HOVER_HINT = 'Hover the chart for detail';
export const DEFAULT_BLOCK_MINUTES = 10;
/** Hosts beyond this many share the neutral colour in the chart, legend, and rows. */
export const PALETTE_SIZE = 6;
/** How far either side of the pointer to look for an active minute. */
export const HOVER_TOLERANCE_MINUTES = 8;

const SVG_NS = 'http://www.w3.org/2000/svg';
/**
 * The chart is a day strip rather than a column chart: a short band where each block is a
 * stretch of time on one site. Nearly every tracked minute is a full minute, so tall bars
 * would all be the same height anyway - the information is in *when*, not *how tall*.
 */
const CHART_HEIGHT = 48;
/** Minutes; the narrowest a run may be drawn so short visits stay visible. */
const MIN_RUN_WIDTH = 4;
const MIN_RUN_HEIGHT = 6;

function q<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) throw new Error(`Missing element: ${selector}`);
  return element;
}

/** Chart colour class for a host, by its rank in the top-sites list. */
export function colourClass(rank: number): string {
  return rank < PALETTE_SIZE ? `tl-${rank}` : 'tl-other';
}

export interface ChartRun {
  start: number;
  end: number;
  host: string;
  activeSeconds: number;
}

/**
 * Groups adjacent minutes spent on the same site into one block.
 *
 * A day is 1440 minutes wide but the chart is a few hundred pixels, so drawing a bar per
 * minute produces sub-pixel slivers that alias into a barcode. Runs draw as solid stretches
 * and there are far fewer of them.
 */
export function toRuns(slots: MinuteSlot[]): ChartRun[] {
  const runs: ChartRun[] = [];
  for (const slot of slots) {
    const last = runs[runs.length - 1];
    if (last !== undefined && last.host === slot.host && last.end === slot.minute) {
      last.end = slot.minute + 1;
      last.activeSeconds = Math.max(last.activeSeconds, slot.activeSeconds);
    } else {
      runs.push({
        start: slot.minute,
        end: slot.minute + 1,
        host: slot.host,
        activeSeconds: slot.activeSeconds,
      });
    }
  }
  return runs;
}

/** The active minute nearest `minute`, or null when the pointer is over a quiet stretch. */
export function nearestSlot(slots: MinuteSlot[], minute: number): MinuteSlot | null {
  let best: MinuteSlot | null = null;
  let bestDistance = HOVER_TOLERANCE_MINUTES + 1;
  for (const slot of slots) {
    const distance = Math.abs(slot.minute - minute);
    if (distance < bestDistance) {
      best = slot;
      bestDistance = distance;
    }
  }
  return bestDistance <= HOVER_TOLERANCE_MINUTES ? best : null;
}

export function createActivityPanel(root: Document, deps: ActivityDeps) {
  const els = {
    date: q<HTMLInputElement>(root, '#activity-date'),
    prev: q<HTMLButtonElement>(root, '#activity-prev'),
    next: q<HTMLButtonElement>(root, '#activity-next'),
    today: q<HTMLButtonElement>(root, '#activity-today'),
    dayLabel: q<HTMLElement>(root, '#activity-day-label'),
    error: q<HTMLElement>(root, '#activity-error'),
    total: q<HTMLElement>(root, '#activity-total'),
    totalSub: q<HTMLElement>(root, '#activity-total-sub'),
    sites: q<HTMLElement>(root, '#activity-sites'),
    peak: q<HTMLElement>(root, '#activity-peak'),
    covered: q<HTMLElement>(root, '#activity-covered'),
    coveredSub: q<HTMLElement>(root, '#activity-covered-sub'),
    hint: q<HTMLElement>(root, '#activity-hint'),
    chart: q<SVGSVGElement>(root, '#activity-chart'),
    tooltip: q<HTMLElement>(root, '#activity-tooltip'),
    tooltipSwatch: q<HTMLElement>(root, '#activity-tooltip-swatch'),
    tooltipTime: q<HTMLElement>(root, '#activity-tooltip-time'),
    tooltipHost: q<HTMLElement>(root, '#activity-tooltip-host'),
    tooltipDur: q<HTMLElement>(root, '#activity-tooltip-dur'),
    legend: q<HTMLUListElement>(root, '#activity-legend'),
    empty: q<HTMLElement>(root, '#activity-empty'),
    topPanel: q<HTMLElement>(root, '#activity-top-panel'),
    topMeta: q<HTMLElement>(root, '#activity-top-meta'),
    top: q<HTMLOListElement>(root, '#activity-top'),
    template: q<HTMLTemplateElement>(root, '#activity-row-template'),
  };

  let date = dateKey(deps.now());
  let view: ActivityView | null = null;
  let bars: SVGRectElement[] = [];
  let rows = new Map<string, HTMLLIElement>();
  let cursor: SVGLineElement | null = null;
  let pinnedHost: string | null = null;

  // ----- data -----

  async function load(next: string = date): Promise<void> {
    date = next;
    try {
      view = await deps.send({ type: 'getActivity', date });
      els.error.hidden = true;
    } catch {
      view = null;
      showError(ACTIVITY_ERROR_TEXT);
    }
    render();
  }

  function showError(message: string): void {
    els.error.textContent = message;
    els.error.hidden = false;
  }

  function shift(days: number): void {
    void load(dateKey(shiftDays(dateStart(date), days)));
  }

  async function block(host: HostTotal, minutes: number): Promise<void> {
    try {
      const response = await deps.send({
        type: 'createRule',
        input: { pattern: host.suggestedPattern, limitMinutes: minutes },
      });
      if (!response.ok) {
        showError(response.error);
        return;
      }
      deps.onRulesChanged?.();
      await load();
    } catch {
      showError(BLOCK_FAILED_TEXT);
    }
  }

  // ----- highlighting -----

  function rankOf(current: ActivityView, host: string): number {
    const index = current.top.findIndex((entry) => entry.host === host);
    return index === -1 ? PALETTE_SIZE : index;
  }

  function highlight(host: string | null): void {
    els.chart.classList.toggle('is-dimmed', host !== null);
    for (const bar of bars) {
      bar.classList.toggle('is-lit', host !== null && bar.dataset['host'] === host);
    }
    for (const [rowHost, row] of rows) {
      row.classList.toggle('is-lit', rowHost === host);
    }
    for (const item of Array.from(els.legend.children)) {
      item.classList.toggle('is-pinned', (item as HTMLElement).dataset['host'] === pinnedHost);
    }
  }

  function hover(host: string | null): void {
    highlight(host ?? pinnedHost);
  }

  function togglePin(host: string): void {
    pinnedHost = pinnedHost === host ? null : host;
    highlight(pinnedHost);
  }

  // ----- rendering -----

  function render(): void {
    if (view === null) return;
    const current = view;
    els.date.value = current.date;
    els.date.min = current.minDate;
    els.date.max = current.maxDate;
    els.prev.disabled = current.date <= current.minDate;
    els.next.disabled = current.date >= current.maxDate;
    els.today.disabled = current.date === current.maxDate;
    els.dayLabel.textContent = formatDayLabel(current.date, deps.now());

    els.total.textContent = formatCompact(current.totalSeconds);
    els.totalSub.textContent =
      current.totalSeconds === 0 ? 'no activity yet' : `across ${current.minutes.length} active minutes`;
    els.sites.textContent = String(current.hostCount);
    els.peak.textContent = current.peakMinute === null ? '—' : formatClock(current.peakMinute);
    const coveredPercent =
      current.totalSeconds === 0 ? 0 : Math.round((current.coveredSeconds / current.totalSeconds) * 100);
    els.covered.textContent = `${coveredPercent}%`;
    els.coveredSub.textContent = `${formatCompact(current.coveredSeconds)} of tracked time`;

    els.empty.hidden = current.top.length > 0;
    els.topPanel.hidden = current.top.length === 0;
    els.topMeta.textContent =
      current.top.length === 0 ? '' : `${current.top.length} of ${current.hostCount}`;

    pinnedHost = current.top.some((entry) => entry.host === pinnedHost) ? pinnedHost : null;
    renderChart(current);
    renderLegend(current);
    renderTop(current);
    highlight(pinnedHost);
  }

  function renderChart(current: ActivityView): void {
    els.chart.replaceChildren();
    els.chart.setAttribute('viewBox', `0 0 ${MINUTES_PER_DAY} ${CHART_HEIGHT}`);
    bars = [];

    // Hour gridlines give the strip a readable scale without an axis component.
    for (let hour = 1; hour < HOURS_PER_DAY; hour += 1) {
      const line = root.createElementNS(SVG_NS, 'line');
      const x = String(hour * 60);
      line.setAttribute('x1', x);
      line.setAttribute('x2', x);
      line.setAttribute('y1', '0');
      line.setAttribute('y2', String(CHART_HEIGHT));
      line.setAttribute('class', 'tl-grid');
      els.chart.appendChild(line);
    }

    for (const run of toRuns(current.minutes)) {
      // A minute only partly spent on a site sits lower in the band.
      const height = Math.max(MIN_RUN_HEIGHT, (run.activeSeconds / 60) * CHART_HEIGHT);
      const bar = root.createElementNS(SVG_NS, 'rect');
      bar.setAttribute('x', String(run.start));
      bar.setAttribute('y', String(CHART_HEIGHT - height));
      // A one-minute glance is a third of a pixel wide; give every run a visible footprint.
      bar.setAttribute('width', String(Math.max(MIN_RUN_WIDTH, run.end - run.start)));
      bar.setAttribute('height', String(height));
      bar.setAttribute('class', `tl-bar ${colourClass(rankOf(current, run.host))}`);
      bar.dataset['host'] = run.host;
      els.chart.appendChild(bar);
      bars.push(bar);
    }

    cursor = root.createElementNS(SVG_NS, 'line');
    cursor.setAttribute('y1', '0');
    cursor.setAttribute('y2', String(CHART_HEIGHT));
    cursor.setAttribute('class', 'tl-cursor');
    cursor.setAttribute('visibility', 'hidden');
    els.chart.appendChild(cursor);
  }

  function renderLegend(current: ActivityView): void {
    els.legend.replaceChildren();
    current.top.slice(0, PALETTE_SIZE).forEach((entry, index) => {
      const item = root.createElement('li');
      item.className = 'legend-item';
      item.dataset['host'] = entry.host;
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      item.setAttribute('data-testid', 'activity-legend-item');

      const swatch = root.createElement('span');
      swatch.className = `legend-swatch ${colourClass(index)}`;
      const label = root.createElement('span');
      label.textContent = entry.host;
      item.append(swatch, label);

      item.addEventListener('click', () => togglePin(entry.host));
      item.addEventListener('mouseenter', () => hover(entry.host));
      item.addEventListener('mouseleave', () => hover(null));
      els.legend.appendChild(item);
    });
  }

  function renderTop(current: ActivityView): void {
    els.top.replaceChildren();
    rows = new Map();
    current.top.forEach((entry, index) => {
      const row = createRow(entry, index);
      rows.set(entry.host, row);
      els.top.appendChild(row);
    });
  }

  function renderSpark(target: SVGSVGElement, hourly: number[], colour: string): void {
    target.replaceChildren();
    target.setAttribute('viewBox', `0 0 ${HOURS_PER_DAY} 10`);
    const busiest = Math.max(...hourly, 1);
    hourly.forEach((seconds, hour) => {
      if (seconds === 0) return;
      const height = Math.max(1, (seconds / busiest) * 10);
      const bar = root.createElementNS(SVG_NS, 'rect');
      bar.setAttribute('x', String(hour + 0.15));
      bar.setAttribute('y', String(10 - height));
      bar.setAttribute('width', '0.7');
      bar.setAttribute('height', String(height));
      bar.setAttribute('class', `spark-bar ${colour}`);
      target.appendChild(bar);
    });
  }

  function createRow(entry: HostTotal, index: number): HTMLLIElement {
    const fragment = els.template.content.cloneNode(true) as DocumentFragment;
    const row = q<HTMLLIElement>(fragment, '.top-row');
    const colour = colourClass(index);
    row.dataset['host'] = entry.host;
    q<HTMLElement>(row, '[data-field="rank"]').textContent = String(index + 1);
    q<HTMLElement>(row, '[data-field="dot"]').classList.add(colour);
    q<HTMLElement>(row, '[data-field="host"]').textContent = entry.host;
    q<HTMLElement>(row, '[data-field="url"]').textContent = entry.url;
    q<HTMLElement>(row, '[data-field="time"]').textContent = formatCompact(entry.seconds);
    q<HTMLElement>(row, '[data-field="share"]').textContent =
      `${Math.round(entry.share * 100)}% · ${entry.visits} ${entry.visits === 1 ? 'visit' : 'visits'}`;
    renderSpark(q<SVGSVGElement>(row, '[data-field="spark"]'), entry.hourly, colour);

    q<HTMLElement>(row, '[data-field="has-rule"]').hidden = !entry.hasRule;
    q<HTMLElement>(row, '[data-field="block-form"]').hidden = entry.hasRule;

    const minutes = q<HTMLInputElement>(row, '[data-field="minutes"]');
    minutes.value = String(DEFAULT_BLOCK_MINUTES);
    q<HTMLButtonElement>(row, '[data-action="block"]').addEventListener('click', () => {
      const value = Number(minutes.value);
      if (!Number.isInteger(value) || value < MIN_LIMIT_MINUTES || value > MAX_LIMIT_MINUTES) {
        minutes.setAttribute('aria-invalid', 'true');
        minutes.focus();
        return;
      }
      minutes.removeAttribute('aria-invalid');
      void block(entry, value);
    });

    row.addEventListener('mouseenter', () => hover(entry.host));
    row.addEventListener('mouseleave', () => hover(null));
    return row;
  }

  // ----- pointer interaction -----

  /** Minute under the pointer, or null when the chart has no width yet. */
  function minuteAt(event: MouseEvent): number | null {
    const box = els.chart.getBoundingClientRect();
    if (box.width === 0) return null;
    const ratio = (event.clientX - box.left) / box.width;
    if (ratio < 0 || ratio > 1) return null;
    return Math.min(MINUTES_PER_DAY - 1, Math.floor(ratio * MINUTES_PER_DAY));
  }

  function hideTooltip(): void {
    els.tooltip.hidden = true;
    els.hint.textContent = HOVER_HINT;
    cursor?.setAttribute('visibility', 'hidden');
    hover(null);
  }

  function showTooltip(event: MouseEvent): void {
    if (view === null) return;
    const minute = minuteAt(event);
    if (minute === null) return;
    const slot = nearestSlot(view.minutes, minute);
    if (slot === null) {
      hideTooltip();
      return;
    }
    els.tooltip.hidden = false;
    els.tooltip.style.left = `${(slot.minute / MINUTES_PER_DAY) * 100}%`;
    els.tooltipSwatch.className = `tooltip-swatch ${colourClass(rankOf(view, slot.host))}`;
    els.tooltipTime.textContent = formatClock(slot.minute);
    els.tooltipHost.textContent = slot.host;
    els.tooltipDur.textContent = formatUsage(slot.activeSeconds);
    els.hint.textContent = `${formatClock(slot.minute)} · ${slot.host}`;
    cursor?.setAttribute('x1', String(slot.minute));
    cursor?.setAttribute('x2', String(slot.minute));
    cursor?.setAttribute('visibility', 'visible');
    hover(slot.host);
  }

  // ----- wiring -----

  els.prev.addEventListener('click', () => shift(-1));
  els.next.addEventListener('click', () => shift(1));
  els.today.addEventListener('click', () => void load(dateKey(deps.now())));
  els.date.addEventListener('change', () => {
    if (els.date.value !== '') void load(els.date.value);
  });
  els.chart.addEventListener('mousemove', showTooltip);
  els.chart.addEventListener('mouseleave', hideTooltip);

  return { load, getDate: () => date };
}
