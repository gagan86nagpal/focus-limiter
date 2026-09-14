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
export const HOVER_HINT = 'Hover for detail · drag across to zoom in';
export const ZOOMED_HINT = 'Drag to zoom further · × for the whole day';
export const DEFAULT_BLOCK_MINUTES = 10;
/** Hosts beyond this many share the neutral colour in the chart, legend, and rows. */
export const PALETTE_SIZE = 6;
/** How far either side of the pointer to look for an active minute, across a whole day. */
export const HOVER_TOLERANCE_MINUTES = 8;
/** A click, as opposed to a drag, zooms to the hour it landed in. */
export const ZOOM_MINUTES = 60;
/** The narrowest window a drag can leave you in, so a twitch cannot zoom to one minute. */
export const MIN_ZOOM_MINUTES = 5;
/** Pointer travel, in pixels, below which a press counts as a click rather than a stretch. */
export const DRAG_THRESHOLD_PX = 4;
/** Labels along the axis, which follow whatever window is on screen. */
export const AXIS_TICKS = 4;

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

/** The stretch of the day the chart is currently drawing, in minutes past midnight. */
export interface ChartWindow {
  start: number;
  end: number;
}

export const WHOLE_DAY: ChartWindow = { start: 0, end: MINUTES_PER_DAY };

/**
 * Gridline spacing for a window, from hourly across a whole day down to every minute in a
 * narrow one. A single ratio cannot serve both ends - a day wants 24 lines and a zoomed hour
 * wants 6 - so the steps are chosen by eye to leave a handful of lines rather than a fence.
 */
export function gridStep(span: number): number {
  if (span <= 15) return 1;
  if (span <= 45) return 5;
  if (span <= 180) return 10;
  if (span <= 480) return 30;
  return 60;
}

/**
 * The window a stretch between minutes `a` and `b` selects. Either may be the start, since
 * dragging leftwards is as natural as rightwards, and the far end is exclusive so that letting
 * go on 10:00 having started at 09:00 leaves an hour rather than an hour and a minute.
 *
 * A very short stretch is widened around its middle rather than honoured literally, and the
 * result is kept inside the window it was drawn on, so zooming can only ever narrow.
 */
export function dragWindow(a: number, b: number, bounds: ChartWindow): ChartWindow {
  const limit = bounds.end - bounds.start;
  const span = Math.min(limit, Math.max(MIN_ZOOM_MINUTES, Math.abs(b - a)));
  const middle = (a + b) / 2;
  const start = Math.round(Math.min(Math.max(middle - span / 2, bounds.start), bounds.end - span));
  return { start, end: start + span };
}

/** Midnight is the end of one window and the start of the next, and reads differently in each. */
export function axisLabel(minute: number): string {
  return minute >= MINUTES_PER_DAY ? '24:00' : formatClock(minute);
}

/**
 * Hover tolerance is a fraction of the visible span rather than a fixed number of minutes.
 * Eight minutes is a couple of pixels across a whole day, but an eighth of a zoomed hour, where
 * it would happily name a minute that is no longer on screen.
 */
export function hoverTolerance(span: number): number {
  return Math.max(1, Math.round((HOVER_TOLERANCE_MINUTES * span) / MINUTES_PER_DAY));
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
export function nearestSlot(
  slots: MinuteSlot[],
  minute: number,
  tolerance: number = HOVER_TOLERANCE_MINUTES,
): MinuteSlot | null {
  let best: MinuteSlot | null = null;
  let bestDistance = tolerance + 1;
  for (const slot of slots) {
    const distance = Math.abs(slot.minute - minute);
    if (distance < bestDistance) {
      best = slot;
      bestDistance = distance;
    }
  }
  return bestDistance <= tolerance ? best : null;
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
    peakSub: q<HTMLElement>(root, '#activity-peak-sub'),
    covered: q<HTMLElement>(root, '#activity-covered'),
    coveredSub: q<HTMLElement>(root, '#activity-covered-sub'),
    hint: q<HTMLElement>(root, '#activity-hint'),
    chart: q<SVGSVGElement>(root, '#activity-chart'),
    axis: q<HTMLElement>(root, '#activity-axis'),
    zoomOut: q<HTMLButtonElement>(root, '#activity-zoom-out'),
    zoomRange: q<HTMLElement>(root, '#activity-zoom-range'),
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
  let pinnedHost: string | null = null;
  /** null means the whole day; otherwise the stretch of it the chart is zoomed into. */
  let zoom: ChartWindow | null = null;
  /** Set while the pointer is down on the strip, from the minute it went down on. */
  let drag: { fromMinute: number; fromX: number; toMinute: number } | null = null;

  // Both overlays live above the bars and outlast each redraw, which keeps them off the
  // render path and out of the null checks that a per-render node would need.
  const cursor = root.createElementNS(SVG_NS, 'line');
  cursor.setAttribute('y1', '0');
  cursor.setAttribute('y2', String(CHART_HEIGHT));
  cursor.setAttribute('class', 'tl-cursor');
  cursor.setAttribute('visibility', 'hidden');

  const band = root.createElementNS(SVG_NS, 'rect');
  band.setAttribute('y', '0');
  band.setAttribute('height', String(CHART_HEIGHT));
  band.setAttribute('class', 'tl-band');
  // Without this the 1px edges would be scaled by the viewBox into fat slabs.
  band.setAttribute('vector-effect', 'non-scaling-stroke');
  band.setAttribute('visibility', 'hidden');
  band.setAttribute('data-testid', 'activity-band');

  // ----- data -----

  async function load(next: string = date): Promise<void> {
    date = next;
    // A zoomed hour means nothing on a different day, and an empty one would look broken.
    zoom = null;
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
    const peak = current.peak;
    els.peak.textContent = peak === null ? '—' : formatClock(peak.hour * 60);
    els.peakSub.textContent =
      peak === null ? 'busiest hour' : `${formatCompact(peak.seconds)} of that hour`;
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
    renderAxis();
    renderZoom();
    renderLegend(current);
    renderTop(current);
    highlight(pinnedHost);
  }

  function renderChart(current: ActivityView): void {
    const { start, end } = zoom ?? WHOLE_DAY;
    const span = end - start;
    els.chart.replaceChildren();
    // Drawing in minutes keeps every x below in absolute clock terms, zoomed or not.
    els.chart.setAttribute('viewBox', `${start} 0 ${span} ${CHART_HEIGHT}`);
    bars = [];

    // Gridlines give the strip a readable scale without an axis component.
    const step = gridStep(span);
    for (let minute = start + step; minute < end; minute += step) {
      const line = root.createElementNS(SVG_NS, 'line');
      const x = String(minute);
      line.setAttribute('x1', x);
      line.setAttribute('x2', x);
      line.setAttribute('y1', '0');
      line.setAttribute('y2', String(CHART_HEIGHT));
      line.setAttribute('class', 'tl-grid');
      els.chart.appendChild(line);
    }

    // A minimum width in minutes would swell to a fat block once zoomed, so it scales with the
    // window and stays the same few pixels on screen.
    const minRun = (MIN_RUN_WIDTH * span) / MINUTES_PER_DAY;
    for (const run of toRuns(current.minutes)) {
      // A minute only partly spent on a site sits lower in the band.
      const height = Math.max(MIN_RUN_HEIGHT, (run.activeSeconds / 60) * CHART_HEIGHT);
      const bar = root.createElementNS(SVG_NS, 'rect');
      bar.setAttribute('x', String(run.start));
      bar.setAttribute('y', String(CHART_HEIGHT - height));
      // A one-minute glance is a third of a pixel wide; give every run a visible footprint.
      bar.setAttribute('width', String(Math.max(minRun, run.end - run.start)));
      bar.setAttribute('height', String(height));
      bar.setAttribute('class', `tl-bar ${colourClass(rankOf(current, run.host))}`);
      bar.dataset['host'] = run.host;
      els.chart.appendChild(bar);
      bars.push(bar);
    }

    els.chart.append(band, cursor);
  }

  function renderAxis(): void {
    const { start, end } = zoom ?? WHOLE_DAY;
    els.axis.replaceChildren();
    for (let tick = 0; tick <= AXIS_TICKS; tick += 1) {
      const label = root.createElement('span');
      label.textContent = axisLabel(start + ((end - start) * tick) / AXIS_TICKS);
      els.axis.appendChild(label);
    }
  }

  function renderZoom(): void {
    const range = zoom;
    els.zoomOut.hidden = range === null;
    els.zoomRange.textContent =
      range === null ? '' : `${formatClock(range.start)}–${axisLabel(range.end)}`;
    els.chart.classList.toggle('is-zoomed', range !== null);
  }

  /** Redraws for a new window. `render` is cheap and already knows how to draw everything. */
  function applyZoom(next: ChartWindow | null): void {
    zoom = next;
    hideTooltip();
    render();
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

  /**
   * Minute under the pointer, or null when the chart has no width to measure against.
   *
   * Hovering past either edge is nothing, but a stretch that runs off the edge is pinned to it,
   * since letting go out there clearly means "to the end". Clamping also allows the far
   * boundary itself: a hover has to name a real minute, where the end of a stretch is a line
   * between them, and the last of those lines is midnight.
   */
  function minuteAt(event: MouseEvent, clamp = false): number | null {
    const box = els.chart.getBoundingClientRect();
    if (box.width === 0) return null;
    let ratio = (event.clientX - box.left) / box.width;
    if (ratio < 0 || ratio > 1) {
      if (!clamp) return null;
      ratio = Math.min(1, Math.max(0, ratio));
    }
    const { start, end } = zoom ?? WHOLE_DAY;
    return Math.min(clamp ? end : end - 1, start + Math.floor(ratio * (end - start)));
  }

  function hideTooltip(): void {
    els.tooltip.hidden = true;
    els.hint.textContent = zoom === null ? HOVER_HINT : ZOOMED_HINT;
    cursor.setAttribute('visibility', 'hidden');
    hover(null);
  }

  function showTooltip(event: MouseEvent): void {
    if (view === null) return;
    const minute = minuteAt(event);
    if (minute === null) return;
    const { start, end } = zoom ?? WHOLE_DAY;
    const slot = nearestSlot(view.minutes, minute, hoverTolerance(end - start));
    if (slot === null) {
      hideTooltip();
      return;
    }
    els.tooltip.hidden = false;
    els.tooltip.style.left = `${((slot.minute - start) / (end - start)) * 100}%`;
    els.tooltipSwatch.className = `tooltip-swatch ${colourClass(rankOf(view, slot.host))}`;
    els.tooltipTime.textContent = formatClock(slot.minute);
    els.tooltipHost.textContent = slot.host;
    els.tooltipDur.textContent = formatUsage(slot.activeSeconds);
    els.hint.textContent = `${formatClock(slot.minute)} · ${slot.host}`;
    cursor.setAttribute('x1', String(slot.minute));
    cursor.setAttribute('x2', String(slot.minute));
    cursor.setAttribute('visibility', 'visible');
    hover(slot.host);
  }

  /** Draws the stretch so far, and reads it out. Shows exactly the window a release would give. */
  function showDrag(current: NonNullable<typeof drag>, event: MouseEvent): void {
    const minute = minuteAt(event, true);
    if (minute === null) return;
    drag = { ...current, toMinute: minute };
    // Below the threshold the release is a click, so there is nothing to preview yet.
    if (Math.abs(event.clientX - current.fromX) < DRAG_THRESHOLD_PX) return;

    const range = dragWindow(current.fromMinute, minute, zoom ?? WHOLE_DAY);
    band.setAttribute('x', String(range.start));
    band.setAttribute('width', String(range.end - range.start));
    band.setAttribute('visibility', 'visible');
    els.chart.classList.add('is-selecting');
    els.hint.textContent =
      `${formatClock(range.start)}–${axisLabel(range.end)} · ` +
      formatCompact((range.end - range.start) * 60);
  }

  function endDrag(): void {
    drag = null;
    band.setAttribute('visibility', 'hidden');
    els.chart.classList.remove('is-selecting');
  }

  // ----- wiring -----

  els.prev.addEventListener('click', () => shift(-1));
  els.next.addEventListener('click', () => shift(1));
  els.today.addEventListener('click', () => void load(dateKey(deps.now())));
  els.date.addEventListener('change', () => {
    if (els.date.value !== '') void load(els.date.value);
  });
  els.chart.addEventListener('mousemove', (event) => {
    if (drag === null) {
      showTooltip(event);
      return;
    }
    showDrag(drag, event);
  });
  els.chart.addEventListener('mouseleave', () => {
    // Leaving the strip mid-stretch is not abandoning it; the release still counts.
    if (drag === null) hideTooltip();
  });
  els.chart.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    const minute = minuteAt(event);
    if (minute === null) return;
    drag = { fromMinute: minute, fromX: event.clientX, toMinute: minute };
    hideTooltip();
    // Otherwise stretching selects the labels either side of the chart.
    event.preventDefault();
  });
  // On the document, so a stretch that ends off the chart still lands.
  root.addEventListener('mouseup', (event) => {
    const current = drag;
    if (current === null) return;
    endDrag();

    const visible = zoom ?? WHOLE_DAY;
    if (Math.abs(event.clientX - current.fromX) >= DRAG_THRESHOLD_PX) {
      applyZoom(dragWindow(current.fromMinute, current.toMinute, visible));
      return;
    }
    // A plain click falls back to the hour it landed in, once there is more than an hour on
    // screen to narrow down from.
    if (visible.end - visible.start <= ZOOM_MINUTES) return;
    const hour = Math.floor(current.fromMinute / ZOOM_MINUTES) * ZOOM_MINUTES;
    applyZoom(dragWindow(hour, hour + ZOOM_MINUTES, visible));
  });
  els.zoomOut.addEventListener('click', () => applyZoom(null));

  return { load, getDate: () => date };
}
