import { describe, expect, it } from 'vitest';
import {
  dateKey,
  dateStart,
  formatClock,
  formatCompact,
  formatDayLabel,
  formatLimit,
  formatRelative,
  formatUsage,
  shiftDays,
  startOfDay,
} from '../../../src/shared/time';

describe('dateKey', () => {
  it('formats a local date with zero-padding', () => {
    const ts = new Date(2026, 0, 5, 13, 30).getTime();
    expect(dateKey(ts)).toBe('2026-01-05');
  });

  it('pads two-digit months and days', () => {
    const ts = new Date(2026, 10, 22, 0, 0).getTime();
    expect(dateKey(ts)).toBe('2026-11-22');
  });
});

describe('startOfDay', () => {
  it('returns local midnight of the same day', () => {
    const ts = new Date(2026, 5, 9, 18, 45, 12, 500).getTime();
    expect(startOfDay(ts)).toBe(new Date(2026, 5, 9, 0, 0, 0, 0).getTime());
  });
});

describe('formatUsage', () => {
  it('shows only seconds under a minute', () => {
    expect(formatUsage(31)).toBe('31s');
    expect(formatUsage(0)).toBe('0s');
  });

  it('shows minutes and seconds under an hour', () => {
    expect(formatUsage(151)).toBe('2m 31s');
    expect(formatUsage(300)).toBe('5m 00s');
  });

  it('shows hours, minutes, and seconds with padding', () => {
    expect(formatUsage(3905)).toBe('1h 05m 05s');
  });

  it('floors fractional seconds and clamps negatives to zero', () => {
    expect(formatUsage(59.9)).toBe('59s');
    expect(formatUsage(-5)).toBe('0s');
  });
});

describe('formatCompact', () => {
  it('shows seconds under a minute', () => {
    expect(formatCompact(38)).toBe('38s');
    expect(formatCompact(0)).toBe('0s');
  });

  it('drops the seconds once there are minutes', () => {
    expect(formatCompact(151)).toBe('2m');
    expect(formatCompact(3599)).toBe('59m');
  });

  it('pads the minutes alongside hours', () => {
    expect(formatCompact(14_760)).toBe('4h 06m');
    expect(formatCompact(3600)).toBe('1h 00m');
  });

  it('floors fractions and clamps negatives to zero', () => {
    expect(formatCompact(59.9)).toBe('59s');
    expect(formatCompact(-5)).toBe('0s');
  });
});

describe('formatLimit', () => {
  it('formats minutes only', () => {
    expect(formatLimit(5)).toBe('5m');
    expect(formatLimit(45)).toBe('45m');
  });

  it('formats whole hours', () => {
    expect(formatLimit(60)).toBe('1h');
    expect(formatLimit(120)).toBe('2h');
  });

  it('formats hours with remaining minutes', () => {
    expect(formatLimit(90)).toBe('1h 30m');
    expect(formatLimit(1440)).toBe('24h');
  });
});

describe('formatRelative', () => {
  const sec = 1000;
  it('reports very recent times as just now', () => {
    expect(formatRelative(0)).toBe('just now');
    expect(formatRelative(9 * sec)).toBe('just now');
  });

  it('reports seconds', () => {
    expect(formatRelative(42 * sec)).toBe('42 seconds ago');
  });

  it('reports minutes with singular and plural', () => {
    expect(formatRelative(60 * sec)).toBe('1 minute ago');
    expect(formatRelative(120 * sec)).toBe('2 minutes ago');
  });

  it('reports hours with singular and plural', () => {
    expect(formatRelative(3600 * sec)).toBe('1 hour ago');
    expect(formatRelative(2 * 3600 * sec)).toBe('2 hours ago');
  });

  it('reports days with singular and plural', () => {
    expect(formatRelative(24 * 3600 * sec)).toBe('1 day ago');
    expect(formatRelative(3 * 24 * 3600 * sec)).toBe('3 days ago');
  });

  it('clamps negative elapsed time', () => {
    expect(formatRelative(-1000)).toBe('just now');
  });
});

describe('shiftDays', () => {
  it('moves to midnight of a later day', () => {
    const ts = new Date(2026, 8, 14, 18, 30).getTime();
    expect(shiftDays(ts, 1)).toBe(new Date(2026, 8, 15, 0, 0, 0, 0).getTime());
  });

  it('moves to midnight of an earlier day, across a month boundary', () => {
    const ts = new Date(2026, 8, 2, 6, 0).getTime();
    expect(shiftDays(ts, -3)).toBe(new Date(2026, 7, 30, 0, 0, 0, 0).getTime());
  });

  it('returns midnight of the same day for a zero shift', () => {
    const ts = new Date(2026, 8, 14, 23, 59).getTime();
    expect(shiftDays(ts, 0)).toBe(startOfDay(ts));
  });
});

describe('dateStart', () => {
  it('is the inverse of dateKey', () => {
    const ts = new Date(2026, 8, 14, 15, 20).getTime();
    expect(dateStart(dateKey(ts))).toBe(startOfDay(ts));
  });

  it('parses a padded key', () => {
    expect(dateStart('2026-01-05')).toBe(new Date(2026, 0, 5).getTime());
  });
});

describe('formatClock', () => {
  it('formats a minute of the day as 24-hour time', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(845)).toBe('14:05');
    expect(formatClock(1439)).toBe('23:59');
  });

  it('clamps out-of-range minutes and floors fractions', () => {
    expect(formatClock(-10)).toBe('00:00');
    expect(formatClock(5000)).toBe('23:59');
    expect(formatClock(90.9)).toBe('01:30');
  });
});

describe('formatDayLabel', () => {
  const now = new Date(2026, 8, 14, 12, 0).getTime();

  it('names today and yesterday', () => {
    expect(formatDayLabel('2026-09-14', now)).toBe('Today');
    expect(formatDayLabel('2026-09-13', now)).toBe('Yesterday');
  });

  it('spells out any other day', () => {
    const label = formatDayLabel('2026-09-10', now);
    expect(label).not.toBe('Today');
    expect(label).not.toBe('Yesterday');
    expect(label).toContain('Sep');
  });
});
