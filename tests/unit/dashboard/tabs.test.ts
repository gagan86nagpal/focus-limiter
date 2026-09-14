import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPageBody } from '../../helpers/dom';
import { setupTabs } from '../../../src/dashboard/tabs';

const tab = (id: string) => document.getElementById(`tab-${id}`) as HTMLButtonElement;
const panel = (id: string) => document.getElementById(`panel-${id}`) as HTMLElement;

function press(id: string, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  tab(id).dispatchEvent(event);
  return event;
}

describe('dashboard tabs', () => {
  beforeEach(() => {
    loadPageBody('dashboard.html');
  });

  it('starts on rules with activity hidden', () => {
    const onSelect = vi.fn();
    const tabs = setupTabs(document, onSelect);

    expect(tabs.current()).toBe('rules');
    expect(panel('rules').hidden).toBe(false);
    expect(panel('activity').hidden).toBe(true);
    expect(onSelect).toHaveBeenCalledWith('rules');
  });

  it('shows the activity panel when its tab is clicked', () => {
    const onSelect = vi.fn();
    const tabs = setupTabs(document, onSelect);
    onSelect.mockClear();

    tab('activity').click();

    expect(tabs.current()).toBe('activity');
    expect(panel('activity').hidden).toBe(false);
    expect(panel('rules').hidden).toBe(true);
    expect(onSelect).toHaveBeenCalledWith('activity');
  });

  it('keeps aria state and roving tabindex in sync', () => {
    setupTabs(document, vi.fn());
    tab('activity').click();

    expect(tab('activity').getAttribute('aria-selected')).toBe('true');
    expect(tab('activity').tabIndex).toBe(0);
    expect(tab('activity').classList.contains('is-active')).toBe(true);
    expect(tab('rules').getAttribute('aria-selected')).toBe('false');
    expect(tab('rules').tabIndex).toBe(-1);
    expect(tab('rules').classList.contains('is-active')).toBe(false);
  });

  it('can be driven programmatically', () => {
    const onSelect = vi.fn();
    const tabs = setupTabs(document, onSelect);

    tabs.select('activity');
    expect(tabs.current()).toBe('activity');

    tabs.select('rules');
    expect(panel('rules').hidden).toBe(false);
  });

  it('moves along the tablist with the arrow keys, taking focus along', () => {
    const tabs = setupTabs(document, vi.fn());

    press('rules', 'ArrowRight');
    expect(tabs.current()).toBe('activity');
    expect(document.activeElement).toBe(tab('activity'));

    press('activity', 'ArrowLeft');
    expect(tabs.current()).toBe('rules');
    expect(document.activeElement).toBe(tab('rules'));
  });

  it('wraps around at the ends of the tablist', () => {
    const tabs = setupTabs(document, vi.fn());
    press('rules', 'ArrowLeft');
    expect(tabs.current()).toBe('activity');
  });

  it('jumps to the first and last tab with Home and End', () => {
    const tabs = setupTabs(document, vi.fn());

    press('rules', 'End');
    expect(tabs.current()).toBe('activity');

    press('activity', 'Home');
    expect(tabs.current()).toBe('rules');
  });

  it('leaves keys it does not handle to the browser', () => {
    const tabs = setupTabs(document, vi.fn());
    const event = press('rules', 'Tab');

    expect(tabs.current()).toBe('rules');
    expect(event.defaultPrevented).toBe(false);
  });

  it('throws a clear error when the markup is missing a tab', () => {
    document.body.innerHTML = '<div></div>';
    expect(() => setupTabs(document, vi.fn())).toThrow('Missing element: #tab-rules');
  });
});
