import { describe, expect, it, vi } from 'vitest';
import { createInboxFeed } from './inbox-feed';
import { createInboxStore } from './inbox-store';

type Cb = (data: unknown) => void;
function fake(caps: unknown = ['list'], withHot = true) {
  const handlers = new Map<string, Cb>();
  const hot = {
    send: vi.fn(),
    on: vi.fn((event: string, cb: Cb) => void handlers.set(event, cb)),
    off: vi.fn((event: string) => void handlers.delete(event)),
  };
  const win = { __passback: { ...(withHot ? { hot } : {}), caps } } as unknown as Window;
  const push = (data: unknown) => handlers.get('passback:items')?.(data);
  return { hot, win, push };
}
const item = (id: unknown, extra = {}) => ({
  id,
  status: 'new',
  comment: 'c',
  iterations: [],
  ...extra,
});

describe('inbox feed', () => {
  it('asks for the list once and replaces its rows with every items message', () => {
    const { hot, win, push } = fake();
    const onChange = vi.fn();
    const feed = createInboxFeed(win, onChange);
    expect(hot.send).toHaveBeenCalledTimes(1);
    expect(hot.send).toHaveBeenCalledWith('passback:list', { v: 1 });
    expect(feed.loaded()).toBe(false);
    push({ v: 1, items: [item('a'), item('b')], truncated: true });
    expect(feed.rows().map((r) => r.id)).toEqual(['a', 'b']);
    expect([feed.truncated(), feed.loaded()]).toEqual([true, true]);
    push({ v: 1, items: [item('c')] });
    expect(feed.rows().map((r) => r.id)).toEqual(['c']);
    expect(feed.truncated()).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(hot.send).toHaveBeenCalledTimes(1);
  });

  it('ignores a message that is not version 1 or has no items array and skips an item without an id', () => {
    const { win, push } = fake();
    const onChange = vi.fn();
    const feed = createInboxFeed(win, onChange);
    push({ v: 1, items: [item('a')] });
    for (const bad of [{ v: 2, items: [] }, { v: 1 }, { v: 1, items: 'x' }, null, 'x']) push(bad);
    expect(feed.rows().map((r) => r.id)).toEqual(['a']);
    expect(onChange).toHaveBeenCalledTimes(1);
    push({ v: 1, items: [item(1), item('b', { iterations: null }), null, item('ok')] });
    expect(feed.rows().map((r) => r.id)).toEqual(['ok']);
  });

  it('stays empty without a channel or without the list capability', () => {
    for (const { win, hot } of [fake(['other']), fake(null), fake(['list'], false)]) {
      const feed = createInboxFeed(win, vi.fn());
      expect([feed.rows(), feed.loaded(), feed.truncated()]).toEqual([[], false, false]);
      expect(hot.send).not.toHaveBeenCalled();
      expect(() => feed.dispose()).not.toThrow();
    }
    expect(() => createInboxFeed({} as Window, vi.fn())).not.toThrow();
  });

  it('stops listening after dispose', () => {
    const { hot, win, push } = fake();
    const onChange = vi.fn();
    const feed = createInboxFeed(win, onChange);
    const cb = hot.on.mock.calls[0]?.[1] as Cb;
    feed.dispose();
    expect(hot.off).toHaveBeenCalledWith('passback:items', cb);
    cb({ v: 1, items: [item('a')] });
    push({ v: 1, items: [item('a')] });
    expect(feed.rows()).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reads the rows of the window inbox store and sends no second list request', () => {
    const { hot, win, push } = fake();
    const store = createInboxStore(win);
    const onChange = vi.fn();
    const feed = createInboxFeed(win, onChange);
    expect(hot.send).toHaveBeenCalledTimes(1);
    expect(hot.on).toHaveBeenCalledTimes(1);
    push({ v: 1, items: [item('a')], truncated: true });
    expect(feed.rows().map((r) => r.id)).toEqual(['a']);
    expect([feed.truncated(), feed.loaded()]).toEqual([true, true]);
    expect(onChange).toHaveBeenCalledTimes(1);
    feed.dispose();
    push({ v: 1, items: [item('b')] });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(store.rows().map((r) => r.id)).toEqual(['b']);
    expect(hot.off).not.toHaveBeenCalled();
  });
});
