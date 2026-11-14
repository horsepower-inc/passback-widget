import { describe, expect, it, vi } from 'vitest';
import { createInboxStore } from './inbox-store';

type Cb = (data: unknown) => void;
function fake() {
  const handlers = new Map<string, Cb>();
  const hot = {
    send: vi.fn(),
    on: vi.fn((event: string, cb: Cb) => void handlers.set(event, cb)),
    off: vi.fn((event: string) => void handlers.delete(event)),
  };
  const bag: Record<string, unknown> = { hot, caps: ['list'], other: 1 };
  const win = { __passback: bag } as unknown as Window;
  const push = (items: unknown[]) => handlers.get('passback:items')?.({ v: 1, items });
  return { hot, win, bag, push };
}
const row = (id: string, status: string, extra = {}) => ({
  id,
  status,
  comment: 'c',
  iterations: [],
  ...extra,
});

describe('inbox store', () => {
  it('publishes itself as the inbox of the window and removes itself on dispose', () => {
    const { win, bag } = fake();
    const store = createInboxStore(win);
    expect(bag.inbox).toBe(store);
    expect(bag.other).toBe(1);
    expect(bag.hot).toBeDefined();
    store.dispose();
    expect('inbox' in bag).toBe(false);
    expect(bag.other).toBe(1);
    const second = createInboxStore(win);
    const third = createInboxStore(win);
    second.dispose();
    expect(bag.inbox).toBe(third);
  });

  it('numbers the rows of Needs you, Working and Fixed in that order and leaves out the others', () => {
    const { win, push } = fake();
    const store = createInboxStore(win);
    push([
      row('w1', 'new'),
      row('f1', 'proposed'),
      row('n1', 'declined'),
      row('t1', 'new', { parked: true }),
      row('x1', 'withdrawn'),
      row('w2', 'ack'),
      row('n2', 'ack', { iterations: [{ n: 1, statuses: [{ state: 'failed', at: 'a' }] }] }),
      row('f2', 'accepted'),
    ]);
    const numbers = ['n1', 'n2', 'w1', 'w2', 'f1', 'f2', 't1', 'x1', 'nope'].map((id) =>
      store.numberOf(id),
    );
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, undefined, undefined, undefined]);
    push([row('w2', 'ack'), row('n1', 'declined')]);
    expect([store.numberOf('n1'), store.numberOf('w2'), store.numberOf('w1')]).toEqual([
      1,
      2,
      undefined,
    ]);
  });

  it('tells its subscribers after each accepted snapshot and not after they unsubscribe', () => {
    const { win, push } = fake();
    const store = createInboxStore(win);
    const a = vi.fn();
    const b = vi.fn(() => {
      throw new Error('boom');
    });
    const off = store.subscribe(a);
    store.subscribe(b);
    push([row('a', 'new')]);
    push([row('a', 'new'), row('b', 'new')]);
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(2);
    off();
    push([]);
    expect(a).toHaveBeenCalledTimes(2);
    expect(store.loaded()).toBe(true);
  });

  it('asks the dev server for the list once', () => {
    const { hot, win, push } = fake();
    const store = createInboxStore(win);
    push([row('a', 'new')]);
    store.subscribe(vi.fn());
    expect(hot.send).toHaveBeenCalledTimes(1);
    expect(hot.send).toHaveBeenCalledWith('passback:list', { v: 1 });
    expect(hot.on).toHaveBeenCalledTimes(1);
    store.dispose();
    expect(hot.off).toHaveBeenCalledTimes(1);
  });
});
