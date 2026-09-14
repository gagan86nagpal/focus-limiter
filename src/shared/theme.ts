export type Theme = 'light' | 'dark';

export interface ThemeStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export const THEME_STORAGE_KEY = 'focus-limiter-theme';

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}

function themeButton(root: Document): HTMLButtonElement {
  const button = root.querySelector<HTMLButtonElement>('#theme-toggle');
  if (button === null) throw new Error('Missing element: #theme-toggle');
  return button;
}

export function setupThemeToggle(
  root: Document,
  storage: ThemeStorage = window.localStorage,
  prefersDark: boolean = systemPrefersDark(),
): { getTheme: () => Theme } {
  const button = themeButton(root);

  const saved = storage.getItem(THEME_STORAGE_KEY);
  let theme: Theme = saved === 'light' || saved === 'dark' ? saved : prefersDark ? 'dark' : 'light';

  function apply(): void {
    root.documentElement.dataset['theme'] = theme;
    const next = theme === 'dark' ? 'light' : 'dark';
    button.textContent = `${next === 'dark' ? 'Dark' : 'Light'} mode`;
    button.setAttribute('aria-label', `Switch to ${next} mode`);
    button.setAttribute('aria-pressed', String(theme === 'dark'));
  }

  button.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    storage.setItem(THEME_STORAGE_KEY, theme);
    apply();
  });

  apply();
  return { getTheme: () => theme };
}
