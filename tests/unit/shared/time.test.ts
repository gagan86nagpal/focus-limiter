import { describe, expect, it } from 'vitest';
import { dateKey, formatLimit, formatRelative, formatUsage, startOfDay } from '../../../src/shared/time';

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
