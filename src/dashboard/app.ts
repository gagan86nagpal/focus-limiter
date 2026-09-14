import type { Message, ResponseFor, RuleResult } from '../shared/messages';
import { MAX_RULES, testPattern, validateRuleInput, type PatternTestResult, type RuleErrors } from '../shared/rules';
import { formatLimit, formatRelative, formatUsage } from '../shared/time';
import type { RuleView, StateView } from '../shared/types';

export interface DashboardDeps {
  send: <M extends Message>(message: M) => Promise<ResponseFor<M>>;
  now: () => number;
}

export const MATCH_TEXT: Record<PatternTestResult, string> = {
  empty: '',
  'no-url': '',
  invalid: '✕ Invalid regular expression',
  match: '✓ This URL matches this rule',
  'no-match': '○ This URL does not match this rule',
};

export const UNREACHABLE_TEXT = "Couldn't reach Focus Limiter. Retrying…";
export const SAVE_FAILED_TEXT = "Couldn't save the rule. Please try again.";
export const DEFAULT_LIMIT_MINUTES = 10;

function q<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) throw new Error(`Missing element: ${selector}`);
  return element;
}

export function createDashboard(root: Document, deps: DashboardDeps) {
  const els = {
    addRule: q<HTMLButtonElement>(root, '#add-rule'),
    emptyAddRule: q<HTMLButtonElement>(root, '#empty-add-rule'),
    ruleCount: q<HTMLElement>(root, '#rule-count'),
    limitNotice: q<HTMLElement>(root, '#limit-notice'),
    emptyState: q<HTMLElement>(root, '#empty-state'),
    ruleList: q<HTMLUListElement>(root, '#rule-list'),
    lastUpdated: q<HTMLElement>(root, '#last-updated'),
    template: q<HTMLTemplateElement>(root, '#rule-card-template'),
    dialog: q<HTMLDialogElement>(root, '#rule-dialog'),
    form: q<HTMLFormElement>(root, '#rule-form'),
    dialogTitle: q<HTMLElement>(root, '#dialog-title'),
    pattern: q<HTMLInputElement>(root, '#pattern'),
    testUrl: q<HTMLInputElement>(root, '#test-url'),
    limit: q<HTMLInputElement>(root, '#limit'),
    patternError: q<HTMLElement>(root, '#pattern-error'),
    limitError: q<HTMLElement>(root, '#limit-error'),
    matchStatus: q<HTMLElement>(root, '#match-status'),
    formError: q<HTMLElement>(root, '#form-error'),
    cancel: q<HTMLButtonElement>(root, '#cancel-rule'),
    save: q<HTMLButtonElement>(root, '#save-rule'),
  };

  const cards = new Map<string, HTMLLIElement>();
  let state: StateView = { rules: [], maxRules: MAX_RULES };
  let editingId: string | null = null;
  let lastUpdatedAt: number | null = null;
  let unreachable = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  // ----- data -----

  async function refresh(): Promise<void> {
    try {
      state = await deps.send({ type: 'getState' });
      lastUpdatedAt = deps.now();
      unreachable = false;
    } catch {
      unreachable = true;
    }
    render();
  }

  async function deleteRule(id: string): Promise<void> {
    await deps.send({ type: 'deleteRule', id }).catch(() => undefined);
    await refresh();
  }

  // ----- rendering -----

  function render(): void {
    const atMax = state.rules.length >= state.maxRules;
    els.ruleCount.textContent = `${state.rules.length} of ${state.maxRules}`;
    els.addRule.disabled = atMax;
    els.limitNotice.hidden = !atMax;
    els.emptyState.hidden = state.rules.length > 0;
    renderList();
    renderFooter();
  }

  function renderFooter(): void {
    els.lastUpdated.classList.toggle('is-error', unreachable);
    // After any refresh, exactly one of these holds: an error, or a recorded timestamp.
    els.lastUpdated.textContent = unreachable
      ? UNREACHABLE_TEXT
      : `Last updated ${formatRelative(deps.now() - (lastUpdatedAt as number))}`;
  }

  function renderList(): void {
    const seen = new Set<string>();
    state.rules.forEach((rule, index) => {
      seen.add(rule.id);
      let card = cards.get(rule.id);
      if (card === undefined) {
        card = createCard(rule.id);
        cards.set(rule.id, card);
      }
      updateCard(card, rule);
      const current = els.ruleList.children[index];
      if (current !== card) {
        els.ruleList.insertBefore(card, current ?? null);
      }
    });
    for (const [id, card] of cards) {
      if (!seen.has(id)) {
        card.remove();
        cards.delete(id);
      }
    }
  }

  function createCard(ruleId: string): HTMLLIElement {
    const fragment = els.template.content.cloneNode(true) as DocumentFragment;
    const card = q<HTMLLIElement>(fragment, '.rule-card');
    card.dataset['ruleId'] = ruleId;
    q<HTMLButtonElement>(card, '[data-action="edit"]').addEventListener('click', () => openDialog(ruleId));
    q<HTMLButtonElement>(card, '[data-action="delete"]').addEventListener('click', () => setConfirming(card, true));
    q<HTMLButtonElement>(card, '[data-action="cancel-delete"]').addEventListener('click', () =>
      setConfirming(card, false),
    );
    q<HTMLButtonElement>(card, '[data-action="confirm-delete"]').addEventListener('click', () => void deleteRule(ruleId));
    return card;
  }

  function setConfirming(card: HTMLLIElement, confirming: boolean): void {
    q<HTMLElement>(card, '[data-field="actions"]').hidden = confirming;
    q<HTMLElement>(card, '[data-field="confirm"]').hidden = !confirming;
    q<HTMLButtonElement>(card, confirming ? '[data-action="cancel-delete"]' : '[data-action="delete"]').focus();
  }

  function updateCard(card: HTMLLIElement, rule: RuleView): void {
    const used = formatUsage(rule.usedSeconds);
    const limit = formatLimit(rule.limitMinutes);
    const percent = Math.min(100, Math.round((rule.usedSeconds / (rule.limitMinutes * 60)) * 100));
    q<HTMLElement>(card, '[data-field="pattern"]').textContent = rule.pattern;
    q<HTMLElement>(card, '[data-field="used"]').textContent = used;
    q<HTMLElement>(card, '[data-field="limit"]').textContent = limit;
    q<HTMLElement>(card, '[data-field="status"]').hidden = !rule.limitReached;
    const progress = q<HTMLElement>(card, '[data-field="progress"]');
    progress.setAttribute('aria-valuenow', String(percent));
    progress.setAttribute('aria-label', `${used} of ${limit} used today`);
    q<HTMLElement>(card, '[data-field="progress-fill"]').style.width = `${percent}%`;
    card.classList.toggle('is-reached', rule.limitReached);
  }

  // ----- dialog -----

  function openDialog(ruleId: string | null): void {
    const rule = state.rules.find((r) => r.id === ruleId);
    editingId = rule === undefined ? null : rule.id;
    els.dialogTitle.textContent = rule === undefined ? 'Create rule' : 'Edit rule';
    els.form.reset();
    els.pattern.value = rule === undefined ? '' : rule.pattern;
    els.limit.value = String(rule === undefined ? DEFAULT_LIMIT_MINUTES : rule.limitMinutes);
    clearErrors();
    updateMatchStatus();
    els.dialog.showModal();
    els.pattern.focus();
  }

  function closeDialog(): void {
    els.dialog.close();
  }

  function clearErrors(): void {
    els.patternError.textContent = '';
    els.limitError.textContent = '';
    els.formError.textContent = '';
    els.pattern.removeAttribute('aria-invalid');
    els.limit.removeAttribute('aria-invalid');
  }

  function showErrors(errors: RuleErrors): void {
    if (errors.pattern !== undefined) {
      els.patternError.textContent = errors.pattern;
      els.pattern.setAttribute('aria-invalid', 'true');
    }
    if (errors.limitMinutes !== undefined) {
      els.limitError.textContent = errors.limitMinutes;
      els.limit.setAttribute('aria-invalid', 'true');
    }
    (errors.pattern !== undefined ? els.pattern : els.limit).focus();
  }

  function updateMatchStatus(): void {
    const result = testPattern(els.pattern.value, els.testUrl.value);
    els.matchStatus.textContent = MATCH_TEXT[result];
    els.matchStatus.className = `match-status is-${result}`;
  }

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    clearErrors();
    const validation = validateRuleInput({ pattern: els.pattern.value, limitMinutes: els.limit.value });
    if (!validation.ok) {
      showErrors(validation.errors);
      return;
    }
    els.save.disabled = true;
    try {
      let response: RuleResult;
      if (editingId === null) {
        response = await deps.send({ type: 'createRule', input: validation.value });
      } else {
        response = await deps.send({ type: 'updateRule', id: editingId, input: validation.value });
      }
      if (!response.ok) {
        if (response.errors !== undefined) {
          showErrors(response.errors);
        } else {
          els.formError.textContent = response.error;
        }
        return;
      }
      closeDialog();
      await refresh();
    } catch {
      els.formError.textContent = SAVE_FAILED_TEXT;
    } finally {
      els.save.disabled = false;
    }
  }

  // ----- wiring -----

  els.addRule.addEventListener('click', () => openDialog(null));
  els.emptyAddRule.addEventListener('click', () => openDialog(null));
  els.cancel.addEventListener('click', closeDialog);
  els.dialog.addEventListener('close', () => {
    editingId = null;
  });
  els.form.addEventListener('submit', (event) => void submit(event));
  els.pattern.addEventListener('input', () => {
    els.patternError.textContent = '';
    els.pattern.removeAttribute('aria-invalid');
    updateMatchStatus();
  });
  els.testUrl.addEventListener('input', updateMatchStatus);
  els.limit.addEventListener('input', () => {
    els.limitError.textContent = '';
    els.limit.removeAttribute('aria-invalid');
  });
  root.addEventListener('visibilitychange', () => {
    if (root.visibilityState === 'visible') void refresh();
  });

  function start(intervalMs = 1000): void {
    void refresh();
    timer = setInterval(() => {
      if (root.visibilityState === 'visible') void refresh();
    }, intervalMs);
  }

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { refresh, start, stop, openDialog, closeDialog };
}
