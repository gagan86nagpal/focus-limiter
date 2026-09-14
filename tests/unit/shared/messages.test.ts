import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, type ChromeMock } from '../../helpers/chrome-mock';
import { sendMessage } from '../../../src/shared/messages';

describe('sendMessage', () => {
  let chromeMock: ChromeMock;

  beforeEach(() => {
    chromeMock = installChromeMock();
  });

  it('delegates to chrome.runtime.sendMessage and returns its result', async () => {
    const state = { rules: [], maxRules: 10 };
    chromeMock.runtime.sendMessage = vi.fn(async () => state);
    const result = await sendMessage({ type: 'getState' });
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({ type: 'getState' });
    expect(result).toBe(state);
  });
});
