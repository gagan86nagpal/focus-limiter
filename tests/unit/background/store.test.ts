import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock, type ChromeMock } from '../../helpers/chrome-mock';
import {
  emptyUsage,
  loadActivity,
  loadData,
  loadRuntime,
  saveActivity,
  saveData,
  saveRuntime,
  saveUsage,
} from '../../../src/background/store';
import type { Rule } from '../../../src/shared/types';

const NOW = new Date(2026, 8, 14, 10, 0, 0).getTime();
const rule: Rule = { id: 'r1', pattern: 'x', limitMinutes: 5, createdAt: NOW };

describe('background store', () => {
  let chromeMock: ChromeMock;

  beforeEach(() => {
    chromeMock = installChromeMock();
  });

  it('emptyUsage builds a zeroed record for today', () => {
    expect(emptyUsage(NOW)).toEqual({ date: '2026-09-14', seconds: {} });
  });

  it('loadData returns empty defaults when nothing is stored', async () => {
    const data = await loadData(NOW);
    expect(data).toEqual({ rules: [], usage: { date: '2026-09-14', seconds: {} } });
  });

  it('loadData keeps usage from the same day', async () => {
    await chromeMock.storage.local.set({
      rules: [rule],
      usage: { date: '2026-09-14', seconds: { r1: 120 } },
    });
    const data = await loadData(NOW);
    expect(data.rules).toEqual([rule]);
    expect(data.usage.seconds['r1']).toBe(120);
  });

  it('loadData discards usage from a previous day', async () => {
    await chromeMock.storage.local.set({
      usage: { date: '2026-09-13', seconds: { r1: 120 } },
    });
    const data = await loadData(NOW);
    expect(data.usage).toEqual({ date: '2026-09-14', seconds: {} });
  });

  it('loadData ignores a non-array rules value', async () => {
    await chromeMock.storage.local.set({ rules: 'nonsense' });
    const data = await loadData(NOW);
    expect(data.rules).toEqual([]);
  });

  it('saveData round-trips rules and usage', async () => {
    await saveData({ rules: [rule], usage: { date: '2026-09-14', seconds: { r1: 30 } } });
    const data = await loadData(NOW);
    expect(data.rules).toEqual([rule]);
    expect(data.usage.seconds['r1']).toBe(30);
  });

  it('saveUsage writes usage without disturbing stored rules', async () => {
    await saveData({ rules: [rule], usage: { date: '2026-09-14', seconds: { r1: 30 } } });
    await saveUsage({ date: '2026-09-14', seconds: { r1: 90 } });
    const data = await loadData(NOW);
    expect(data.rules).toEqual([rule]);
    expect(data.usage.seconds['r1']).toBe(90);
  });

  it('loadActivity returns an empty history when nothing is stored', async () => {
    expect(await loadActivity()).toEqual([]);
  });

  it('loadActivity ignores a non-array activity value', async () => {
    await chromeMock.storage.local.set({ activity: 'nonsense' });
    expect(await loadActivity()).toEqual([]);
  });

  it('saveActivity round-trips the history without disturbing rules', async () => {
    const days = [
      { date: '2026-09-14', segments: [{ url: 'https://x.com/', host: 'x.com', startedAt: 1, endedAt: 2 }] },
    ];
    await saveData({ rules: [rule], usage: { date: '2026-09-14', seconds: {} } });
    await saveActivity(days);
    expect(await loadActivity()).toEqual(days);
    expect((await loadData(NOW)).rules).toEqual([rule]);
  });

  it('loadRuntime returns defaults when nothing is stored', async () => {
    expect(await loadRuntime()).toEqual({ session: null, focused: true, idle: false });
  });

  it('saveRuntime round-trips the runtime state', async () => {
    const session = { tabId: 3, url: 'https://x.com', ruleIds: ['r1'], startedAt: NOW };
    await saveRuntime({ session, focused: false, idle: true });
    expect(await loadRuntime()).toEqual({ session, focused: false, idle: true });
  });
});
