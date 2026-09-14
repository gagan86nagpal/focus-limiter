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
  reachedHint: 'Choose how much longer, then continue.',
  /** Says plainly that picking an amount has not spent anything yet. */
  stagedHint: (minutes: number) => `+${String(minutes)} min is added when you continue.`,
  continueLabel: 'Continue',
  continueWith: (minutes: number) => `Add ${String(minutes)} min and continue`,
  extendedTitle: 'Limit increased',
  timeLeft: (remaining: string) => `You have ${remaining} left today for this rule.`,
  missingTitle: 'This rule no longer exists',
  missingMessage: 'The rule that blocked this page has been removed. You can continue.',
  errorTitle: 'Something went wrong',
  errorMessage: "Couldn't reach Focus Limiter. Try reloading this page.",
  maxHint: `Limits can't exceed ${formatLimit(MAX_LIMIT_MINUTES)} per day.`,
  customMinutesError: (maximum: number) => `Enter a whole number from 1 to ${maximum}.`,
} as const;

export const DASHBOARD_PAGE = 'dashboard.html';

function q<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) throw new Error(`Missing element: ${selector}`);
  return element;
}

/**
 * `root` is a subtree rather than the document so the demo site can mount this page inside a
 * panel that already holds the dashboard.
 */
export function createBlockedPage(root: ParentNode, deps: BlockedDeps) {
  const params = new URLSearchParams(deps.search);
  const ruleId = params.get('rule') ?? '';
  const originalUrl = params.get('url') ?? '';

  const els = {
    title: q<HTMLElement>(root, '#title'),
    pattern: q<HTMLElement>(root, '#blocked-pattern'),
    usage: q<HTMLElement>(root, '#usage'),
    used: q<HTMLElement>(root, '#used'),
    limit: q<HTMLElement>(root, '#blocked-limit'),
    message: q<HTMLElement>(root, '#message'),
    extend: q<HTMLElement>(root, '#extend'),
    extendButtons: Array.from(root.querySelectorAll<HTMLButtonElement>('[data-extend]')),
    customForm: q<HTMLFormElement>(root, '#extend-custom'),
    customInput: q<HTMLInputElement>(root, '#custom-minutes'),
    customSubmit: q<HTMLButtonElement>(root, '#extend-custom-submit'),
    customError: q<HTMLElement>(root, '#custom-minutes-error'),
    continueButton: q<HTMLButtonElement>(root, '#continue'),
    hint: q<HTMLElement>(root, '#hint'),
  };

  let rule: RuleView | null = null;
  let extended = false;
  /**
   * Minutes the user has picked but not yet spent. Choosing an amount used to write it straight
   * through, which meant the limit had already moved by the time you read the button that was
   * supposedly going to move it. Nothing is written until Continue.
   */
  let staged: number | null = null;

  function renderMissing(title: string, message: string): void {
    els.title.textContent = title;
    els.pattern.textContent = '';
    els.usage.hidden = true;
    els.extend.hidden = true;
    els.message.textContent = message;
    els.hint.textContent = '';
    els.continueButton.textContent = TEXT.continueLabel;
    els.continueButton.disabled = false;
  }

  function render(): void {
    if (rule === null) {
      renderMissing(TEXT.missingTitle, TEXT.missingMessage);
      return;
    }
    const remaining = rule.limitMinutes * 60 - rule.usedSeconds;
    const atMax = rule.limitMinutes >= MAX_LIMIT_MINUTES;
    const maximumExtension = MAX_LIMIT_MINUTES - rule.limitMinutes;

    els.pattern.textContent = rule.pattern;
    els.usage.hidden = false;
    els.extend.hidden = false;
    els.used.textContent = formatUsage(rule.usedSeconds);
    els.limit.textContent = formatLimit(rule.limitMinutes);
    for (const button of els.extendButtons) {
      const chosen = staged === Number(button.dataset['extend']);
      button.disabled = atMax;
      button.classList.toggle('is-selected', chosen);
      button.setAttribute('aria-pressed', String(chosen));
    }
    els.customInput.disabled = atMax;
    els.customInput.max = String(maximumExtension);
    els.customSubmit.disabled = atMax;
    els.continueButton.textContent =
      staged === null ? TEXT.continueLabel : TEXT.continueWith(staged);

    let hint = '';
    if (staged !== null) hint = TEXT.stagedHint(staged);
    else if (atMax) hint = TEXT.maxHint;
    else if (rule.limitReached) hint = TEXT.reachedHint;

    if (rule.limitReached) {
      els.title.textContent = TEXT.reachedTitle;
      els.message.textContent = TEXT.reachedMessage;
      // Nothing has been spent yet, so the way out only opens once an amount is chosen.
      els.continueButton.disabled = staged === null;
    } else {
      els.title.textContent = extended ? TEXT.extendedTitle : TEXT.reachedTitle;
      els.message.textContent = TEXT.timeLeft(formatUsage(remaining));
      els.continueButton.disabled = false;
    }
    els.hint.textContent = hint;
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

  /** Picks an amount without spending it. Passing null clears the choice. */
  function stage(minutes: number | null): void {
    staged = minutes;
    els.customError.textContent = '';
    els.customInput.removeAttribute('aria-invalid');
    render();
  }

  function stageCustom(): void {
    const minutes = Number(els.customInput.value);
    const maximum = rule === null ? 0 : MAX_LIMIT_MINUTES - rule.limitMinutes;
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > maximum) {
      els.customInput.setAttribute('aria-invalid', 'true');
      els.customError.textContent = TEXT.customMinutesError(maximum);
      return;
    }
    stage(minutes);
  }

  /** Writes the chosen minutes through. False means the write failed and the page should stay. */
  async function spend(minutes: number): Promise<boolean> {
    els.continueButton.disabled = true;
    try {
      const response = await deps.send({ type: 'extendLimit', id: ruleId, minutes });
      rule = response.ok ? response.rule : null;
      extended = true;
      staged = null;
      els.customInput.value = '';
      render();
      return true;
    } catch {
      els.continueButton.disabled = false;
      els.hint.textContent = TEXT.errorMessage;
      return false;
    }
  }

  async function continueToSite(): Promise<void> {
    // The single commit point: the limit moves and the tab leaves, or neither happens.
    if (staged !== null && !(await spend(staged))) return;
    deps.navigate(isTrackableUrl(originalUrl) ? originalUrl : DASHBOARD_PAGE);
  }

  for (const button of els.extendButtons) {
    button.addEventListener('click', () => {
      const minutes = Number(button.dataset['extend']);
      // Clicking the chosen amount again takes it back off.
      stage(staged === minutes ? null : minutes);
    });
  }
  els.customForm.addEventListener('submit', (event) => {
    event.preventDefault();
    stageCustom();
  });
  els.customInput.addEventListener('input', () => {
    els.customInput.removeAttribute('aria-invalid');
    els.customError.textContent = '';
  });
  els.continueButton.addEventListener('click', () => void continueToSite());
  deps.subscribe?.(() => void load());

  return { load };
}
