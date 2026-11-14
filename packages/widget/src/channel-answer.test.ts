import { describe, expect, it, vi } from 'vitest';
import { sendAnswer } from './channel';

describe('sendAnswer', () => {
  it('sendAnswer posts the answer message and reports false without a hot object', () => {
    const send = vi.fn();
    expect(sendAnswer({ send }, 'm1', 'blue')).toBe(true);
    expect(send).toHaveBeenCalledWith('passback:answer', { v: 1, markId: 'm1', text: 'blue' });
    expect(sendAnswer(undefined, 'm1', 'blue')).toBe(false);
  });

  it('sendAnswer does not throw when the hot object throws', () => {
    const send = vi.fn(() => {
      throw new Error('closed');
    });
    expect(sendAnswer({ send }, 'm1', 'blue')).toBe(false);
  });
});
