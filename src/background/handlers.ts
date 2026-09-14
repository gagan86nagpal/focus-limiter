import type { Message } from '../shared/messages';
import type { Tracker } from './tracker';

/** Routes a runtime message to the tracker. Unknown messages get a structured error. */
export async function handleMessage(tracker: Tracker, message: unknown): Promise<unknown> {
  const msg = message as Message;
  switch (msg.type) {
    case 'getState':
      return tracker.getState();
    case 'getActivity':
      return tracker.getActivity(msg.date);
    case 'createRule':
      return tracker.createRule(msg.input);
    case 'updateRule':
      return tracker.updateRule(msg.id, msg.input);
    case 'deleteRule':
      return tracker.deleteRule(msg.id);
    case 'extendLimit':
      return tracker.extendLimit(msg.id, msg.minutes);
    default:
      return { ok: false, error: 'Unknown message' };
  }
}
