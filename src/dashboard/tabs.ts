export type TabId = 'rules' | 'activity';

export const TAB_IDS: TabId[] = ['rules', 'activity'];

function el<T extends Element>(root: Document, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (found === null) throw new Error(`Missing element: ${selector}`);
  return found;
}

export interface TabsApi {
  select: (id: TabId) => void;
  current: () => TabId;
}

/**
 * Wires the tablist. Panels stay in the DOM and are toggled with `hidden` so the rules tab
 * keeps its scroll position and in-flight edits when you look at activity and come back.
 */
export function setupTabs(root: Document, onSelect: (id: TabId) => void): TabsApi {
  const tabs = new Map<TabId, HTMLButtonElement>();
  const panels = new Map<TabId, HTMLElement>();
  for (const id of TAB_IDS) {
    tabs.set(id, el<HTMLButtonElement>(root, `#tab-${id}`));
    panels.set(id, el<HTMLElement>(root, `#panel-${id}`));
  }

  let active: TabId = 'rules';

  function select(id: TabId): void {
    active = id;
    for (const tabId of TAB_IDS) {
      const tab = tabs.get(tabId) as HTMLButtonElement;
      const panel = panels.get(tabId) as HTMLElement;
      const selected = tabId === id;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      tab.classList.toggle('is-active', selected);
      panel.hidden = !selected;
    }
    onSelect(id);
  }

  /** Arrow keys move along the tablist and take focus with them, per the ARIA tabs pattern. */
  function step(offset: number): void {
    const index = TAB_IDS.indexOf(active);
    const next = TAB_IDS[(index + offset + TAB_IDS.length) % TAB_IDS.length] as TabId;
    select(next);
    (tabs.get(next) as HTMLButtonElement).focus();
  }

  for (const id of TAB_IDS) {
    const tab = tabs.get(id) as HTMLButtonElement;
    tab.addEventListener('click', () => select(id));
    tab.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight') step(1);
      else if (event.key === 'ArrowLeft') step(-1);
      else if (event.key === 'Home') select(TAB_IDS[0] as TabId);
      else if (event.key === 'End') select(TAB_IDS[TAB_IDS.length - 1] as TabId);
      else return;
      event.preventDefault();
    });
  }

  select(active);
  return { select, current: () => active };
}
