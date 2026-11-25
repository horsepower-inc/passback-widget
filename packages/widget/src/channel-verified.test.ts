import { describe, expect, it, vi } from 'vitest';
import { sendVerified } from './channel';

describe('sendVerified', () => {
  it('sendVerified sends version 1 messages of at most twenty ids', () => {
    const send = vi.fn();
    const ids = Array.from({ length: 45 }, (_, i) => `m${i}`);
    expect(sendVerified({ send }, ids)).toBe(true);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenNthCalledWith(1, 'passback:verified', {
      v: 1,
      markIds: ids.slice(0, 20),
    });
    expect(send).toHaveBeenNthCalledWith(3, 'passback:verified', { v: 1, markIds: ids.slice(40) });
  });

  it('sendVerified answers false and never throws without hot, ids or a working send', () => {
    const send = vi.fn(() => {
      throw new Error('down');
    });
    expect(sendVerified(undefined, ['a'])).toBe(false);
    expect(sendVerified({ send }, [])).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(sendVerified({ send }, ['a'])).toBe(false);
  });
});
