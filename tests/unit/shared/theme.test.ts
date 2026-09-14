import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setupThemeToggle,
  THEME_STORAGE_KEY,
  type ThemeStorage,
} from '../../../src/shared/theme';

function storage(saved: string | null) {
  return {
    getItem: vi.fn(() => saved),
    setItem: vi.fn<(key: string, value: string) => void>(),
  } satisfies ThemeStorage;
}

describe('theme toggle', () => {
  beforeEach(() => {
    document.body.innerHTML = '<button id="theme-toggle"></button>';
    delete document.documentElement.dataset['theme'];
  });

  it.each([
    ['dark', 'dark', 'Light mode'],
    ['light', 'light', 'Dark mode'],
  ] as const)('restores a saved %s theme', (saved, expected, label) => {
    const result = setupThemeToggle(document, storage(saved), false);
    expect(result.getTheme()).toBe(expected);
    expect(document.documentElement.dataset['theme']).toBe(expected);
    expect(document.getElementById('theme-toggle')?.textContent).toBe(label);
  });

  it('uses the system preference when there is no saved theme', () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn(() => ({ matches: true }) as MediaQueryList);
    const result = setupThemeToggle(document, storage(null));
    window.matchMedia = original;
    expect(result.getTheme()).toBe('dark');
  });

  it('falls back to light for an invalid saved value', () => {
    expect(setupThemeToggle(document, storage('unknown'), false).getTheme()).toBe('light');
  });

  it('toggles and persists the explicit preference', () => {
    const store = storage('dark');
    const result = setupThemeToggle(document, store, false);
    document.getElementById('theme-toggle')?.click();
    expect(result.getTheme()).toBe('light');
    expect(store.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'light');
    expect(document.getElementById('theme-toggle')?.getAttribute('aria-label')).toBe(
      'Switch to dark mode',
    );
    expect(document.getElementById('theme-toggle')?.getAttribute('aria-pressed')).toBe('false');

    document.getElementById('theme-toggle')?.click();
    expect(result.getTheme()).toBe('dark');
    expect(store.setItem).toHaveBeenLastCalledWith(THEME_STORAGE_KEY, 'dark');
  });

  it('throws when the toggle is missing', () => {
    document.body.innerHTML = '';
    expect(() => setupThemeToggle(document, storage(null), false)).toThrow(
      'Missing element: #theme-toggle',
    );
  });
});
