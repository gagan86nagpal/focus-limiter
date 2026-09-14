import type { Message, ResponseFor } from '../shared/messages';
import { MAX_LIMIT_MINUTES, isTrackableUrl } from '../shared/rules';
import { formatLimit, formatUsage } from '../shared/time';
import type { RuleView } from '../shared/types';

export interface BlockedDeps {
  send: <M extends Message>(message: M) => Promise<ResponseFor<M>>;
  navigate: (url: string) => void;
  search: string;
  /**
   * Registers a callback for stored-state changes. A page whose initial load found no rule
   * hides its controls, so without this it would stay stuck until a manual reload.
   */
  subscribe?: (onChange: () => void) => void;
}

export const TEXT = {
  reachedTitle: 'Daily limit reached',
  reachedMessage: "You've reached today's limit for this rule.",
  reachedHint: 'Increase your limit to continue.',
  extendedTitle: 'Limit increased',
  timeLeft: (remaining: string) => `You have ${remaining} left today for this rule.`,
  missingTitle: 'This rule no longer exists',
  missingMessage: 'The rule that blocked this page has been removed. You can continue.',
  errorTitle: 'Something went wrong',
  errorMessage: "Couldn't reach Focus Limiter. Try reloading this page.",
  maxHint: `Limits can't exceed ${formatLimit(MAX_LIMIT_MINUTES)} per day.`,
} as const;

export const DASHBOARD_PAGE = 'dashboard.html';

function q<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) throw new Error(`Missing element: ${selector}`);
  return element;
}

export function createBlockedPage(root: Document, deps: BlockedDeps) {
  const params = new URLSearchParams(deps.search);
  const ruleId = params.get('rule') ?? '';
  const originalUrl = params.get('url') ?? '';

  const els = {
    title: q<HTMLElement>(root, '#title'),
    pattern: q<HTMLElement>(root, '#pattern'),
    usage: q<HTMLElement>(root, '#usage'),
    used: q<HTMLElement>(root, '#used'),
    limit: q<HTMLElement>(root, '#limit'),
    message: q<HTMLElement>(root, '#message'),
    extend: q<HTMLElement>(root, '#extend'),
    extendButtons: Array.from(root.querySelectorAll<HTMLButtonElement>('[data-extend]')),
    continueButton: q<HTMLButtonElement>(root, '#continue'),
    hint: q<HTMLElement>(root, '#hint'),
  };

  let rule: RuleView | null = null;
  let extended = false;

  function renderMissing(title: string, message: string): void {
    els.title.textContent = title;
    els.pattern.textContent = '';
    els.usage.hidden = true;
    els.extend.hidden = true;
    els.message.textContent = message;
    els.hint.textContent = '';
    els.continueButton.disabled = false;
  }

  function render(): void {
    if (rule === null) {
      renderMissing(TEXT.missingTitle, TEXT.missingMessage);
      return;
    }
    const remaining = rule.limitMinutes * 60 - rule.usedSeconds;
    const atMax = rule.limitMinutes >= MAX_LIMIT_MINUTES;

    els.pattern.textContent = rule.pattern;
    els.usage.hidden = false;
    els.extend.hidden = false;
    els.used.textContent = formatUsage(rule.usedSeconds);
    els.limit.textContent = formatLimit(rule.limitMinutes);
    for (const button of els.extendButtons) button.disabled = atMax;

    if (rule.limitReached) {
      els.title.textContent = TEXT.reachedTitle;
      els.message.textContent = TEXT.reachedMessage;
      els.continueButton.disabled = true;
      els.hint.textContent = atMax ? TEXT.maxHint : TEXT.reachedHint;
    } else {
      els.title.textContent = extended ? TEXT.extendedTitle : TEXT.reachedTitle;
      els.message.textContent = TEXT.timeLeft(formatUsage(remaining));
      els.continueButton.disabled = false;
      els.hint.textContent = atMax ? TEXT.maxHint : '';
    }
  }

  async function load(): Promise<void> {
    try {
      const state = await deps.send({ type: 'getState' });
      rule = state.rules.find((r) => r.id === ruleId) ?? null;
      render();
    } catch {
      renderMissing(TEXT.errorTitle, TEXT.errorMessage);
    }
  }

  async function extend(minutes: number): Promise<void> {
    for (const button of els.extendButtons) button.disabled = true;
    try {
      const response = await deps.send({ type: 'extendLimit', id: ruleId, minutes });
      rule = response.ok ? response.rule : null;
      extended = true;
      render();
    } catch {
      for (const button of els.extendButtons) button.disabled = false;
      els.hint.textContent = TEXT.errorMessage;
    }
  }

  function continueToSite(): void {
    deps.navigate(isTrackableUrl(originalUrl) ? originalUrl : DASHBOARD_PAGE);
  }

  for (const button of els.extendButtons) {
    button.addEventListener('click', () => void extend(Number(button.dataset['extend'])));
  }
  els.continueButton.addEventListener('click', continueToSite);
  deps.subscribe?.(() => void load());

  return { load, extend, continueToSite };
}
