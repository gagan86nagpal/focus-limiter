import type { ActivityView, Rule, RuleView, StateView } from './types';

/** Requests the UI can send to the background service worker. */
export type Message =
  | { type: 'getState' }
  | { type: 'getActivity'; date: string }
  | { type: 'createRule'; input: { pattern: unknown; limitMinutes: unknown } }
  | { type: 'updateRule'; id: string; input: { pattern: unknown; limitMinutes: unknown } }
  | { type: 'deleteRule'; id: string }
  | { type: 'extendLimit'; id: string; minutes: number };

export type RuleResult =
  | { ok: true; rule: Rule }
  | { ok: false; error: string; errors?: { pattern?: string; limitMinutes?: string } };

export type RuleViewResult =
  | { ok: true; rule: RuleView }
  | { ok: false; error: string };

export interface ResponseMap {
  getState: StateView;
  getActivity: ActivityView;
  createRule: RuleResult;
  updateRule: RuleResult;
  deleteRule: { ok: true };
  extendLimit: RuleViewResult;
}

export type ResponseFor<M extends Message> = ResponseMap[M['type']];

/** Thin typed wrapper over chrome.runtime.sendMessage. */
export function sendMessage<M extends Message>(message: M): Promise<ResponseFor<M>> {
  return chrome.runtime.sendMessage(message) as Promise<ResponseFor<M>>;
}
