import { describe, expect, it, vi } from 'vitest';
import { sendReopen } from './channel';

describe('sendReopen', () => {
  it('sendReopen sends a version 1 message and answers true', () => {
    const send = vi.fn();
    expect(sendReopen({ send }, 'm1', 'still broken')).toBe(true);
    expect(send).toHaveBeenCalledWith('passback:reopen', {
      v: 1,
      markId: 'm1',
      comment: 'still broken',
    });
  });

  it('sendReopen answers false and never throws when send throws', () => {
    const send = vi.fn(() => {
      throw new Error('socket closed');
    });
    expect(sendReopen({ send }, 'm1', 'c')).toBe(false);
  });

  it('sendReopen answers false without a hot object', () => {
    expect(sendReopen(undefined, 'm1', 'c')).toBe(false);
  });
});
