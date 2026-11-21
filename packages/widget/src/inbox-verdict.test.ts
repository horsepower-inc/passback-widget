import { describe, expect, it, vi } from 'vitest';
import type { Hot } from './channel';
import { createVerdictPort, sendVerdict, verdictOf } from './inbox-verdict';

const fakeHot = (impl?: () => void) => {
  const send = vi.fn(() => impl?.());
  return { hot: { send, on: vi.fn(), off: vi.fn() } as unknown as Hot, send };
};

describe('inbox verdict', () => {
  it('sendVerdict sends a version 1 verdict message and answers true', () => {
    const { hot, send } = fakeHot();
    expect(sendVerdict(hot, 'm1', 'accept')).toBe(true);
    expect(send).toHaveBeenCalledWith('passback:verdict', {
      v: 1,
      markId: 'm1',
      verdict: 'accept',
    });
  });

  it('sendVerdict answers false and never throws when send throws or there is no hot object', () => {
    const { hot } = fakeHot(() => {
      throw new Error('closed');
    });
    expect(sendVerdict(hot, 'm1', 'accept')).toBe(false);
    expect(sendVerdict(undefined, 'm1', 'accept')).toBe(false);
  });

  it('createVerdictPort exists only when the caps list verdict and sends one accept per id', () => {
    const { hot, send } = fakeHot();
    expect(createVerdictPort({ hot, caps: ['list', 'reopen'] })).toBeUndefined();
    expect(createVerdictPort({ hot, caps: undefined })).toBeUndefined();
    expect(createVerdictPort({ hot: undefined, caps: ['verdict'] })).toBeUndefined();
    const port = createVerdictPort({ hot, caps: ['verdict'] });
    expect(port?.accept('a')).toBe(true);
    send.mockClear();
    expect(port?.acceptAll(['a', 'b', 'c'])).toBe(3);
    expect(send.mock.calls.map((c) => (c as unknown[])[1])).toEqual([
      { v: 1, markId: 'a', verdict: 'accept' },
      { v: 1, markId: 'b', verdict: 'accept' },
      { v: 1, markId: 'c', verdict: 'accept' },
    ]);
    const win = { __passback: { hot, caps: ['verdict'] } } as unknown as Window;
    expect(verdictOf(win)).toBeDefined();
    expect(verdictOf({} as Window)).toBeUndefined();
  });

  it('createVerdictPort sends withdraw, park and unpark for one id and answers false when send throws', () => {
    const { hot, send } = fakeHot();
    const port = createVerdictPort({ hot, caps: ['verdict'] });
    expect([port?.withdraw('a'), port?.park('b'), port?.unpark('c')]).toEqual([true, true, true]);
    expect(send.mock.calls.map((c) => (c as unknown[])[1])).toEqual([
      { v: 1, markId: 'a', verdict: 'withdraw' },
      { v: 1, markId: 'b', verdict: 'park' },
      { v: 1, markId: 'c', verdict: 'unpark' },
    ]);
    const broken = fakeHot(() => {
      throw new Error('closed');
    });
    const failing = createVerdictPort({ hot: broken.hot, caps: ['verdict'] });
    expect([failing?.withdraw('a'), failing?.park('a'), failing?.unpark('a')]).toEqual([
      false,
      false,
      false,
    ]);
  });
});
