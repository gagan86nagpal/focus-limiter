export type TabId = 'rules' | 'activity';

/** A tablist has at least one tab, which is what lets the indexing below skip its guards. */
export type TabIds<T extends string> = readonly [T, ...T[]];

export const TAB_IDS: TabIds<TabId> = ['rules', 'activity'];

function el<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (found === null) throw new Error(`Missing element: ${selector}`);
  return found;
}

export interface TabsApi<T extends string = TabId> {
  select: (id: T) => void;
  current: () => T;
}

/**
 * Wires a tablist. Panels stay in the DOM and are toggled with `hidden` so a panel keeps its
 * scroll position and in-flight edits while another one is on screen.
 *
 * Elements are read as `#{prefix}tab-{id}` and `#{prefix}panel-{id}`, so one page can carry
 * several independent tablists without their selectors colliding.
 */
export function createTabList<T extends string>(
  root: ParentNode,
  ids: TabIds<T>,
  prefix: string,
  onSelect: (id: T) => void,
): TabsApi<T> {
  const tabs = new Map<T, HTMLButtonElement>();
  const panels = new Map<T, HTMLElement>();
  for (const id of ids) {
    tabs.set(id, el<HTMLButtonElement>(root, `#${prefix}tab-${id}`));
    panels.set(id, el<HTMLElement>(root, `#${prefix}panel-${id}`));
  }

  let active: T = ids[0];

  function select(id: T): void {
    active = id;
    for (const tabId of ids) {
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
    const index = ids.indexOf(active);
    const next = ids[(index + offset + ids.length) % ids.length] as T;
    select(next);
    (tabs.get(next) as HTMLButtonElement).focus();
  }

  for (const id of ids) {
    const tab = tabs.get(id) as HTMLButtonElement;
    tab.addEventListener('click', () => select(id));
    tab.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight') step(1);
      else if (event.key === 'ArrowLeft') step(-1);
      else if (event.key === 'Home') select(ids[0]);
      else if (event.key === 'End') select(ids[ids.length - 1] as T);
      else return;
      event.preventDefault();
    });
  }

  select(active);
  return { select, current: () => active };
}

/** The dashboard's own Rules/Activity tablist. */
export function setupTabs(root: ParentNode, onSelect: (id: TabId) => void): TabsApi<TabId> {
  return createTabList(root, TAB_IDS, '', onSelect);
}
