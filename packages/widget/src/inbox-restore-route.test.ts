// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collect, type Collector } from './collect';
import { watchInbox } from './inbox-restore';

type Cb = (data: unknown) => void;
const row = (id: string, route?: string) => ({
  id,
  status: 'new',
  comment: 'c',
  iterations: [],
  selector: `[data-testid="${id}"]`,
  target: { tag: 'button', text: id },
  ...(route === undefined ? {} : { route }),
});
const tick = () => new Promise((r) => setTimeout(r, 0));

function harness(route?: () => string) {
  const handlers = new Map<string, Cb>();
  const hot = {
    send: vi.fn(),
    on: vi.fn((event: string, cb: Cb) => void handlers.set(event, cb)),
    off: vi.fn((event: string) => void handlers.delete(event)),
  };
  const win = { __passback: { hot, caps: ['list'] }, document: {} } as unknown as Window;
  const collector = {
    reresolve: vi.fn(() => ({ element: {} as Element, via: 'testid' })),
    ...(route ? { route } : {}),
  } as unknown as Collector;
  const restore = vi.fn();
  watchInbox({ win, ensureCollector: () => Promise.resolve(collector), restore });
  const push = async (...items: unknown[]) => {
    handlers.get('passback:items')?.({ v: 1, items });
    await tick();
  };
  const ids = (call: number) => (restore.mock.calls[call]![0] as { id: string }[]).map((e) => e.id);
  return { push, restore, ids };
}

afterEach(() => window.history.replaceState({}, '', '/'));

describe('restore by route', () => {
  it('restores a row only on the page whose route matches the stored one', async () => {
    const h = harness(() => '/about');
    await h.push(row('a', '/checkout'), row('b', '/about'));
    expect(h.ids(0)).toEqual(['b']);
  });

  it('restores every row when the collector cannot name the route or a row has no route', async () => {
    const old = harness();
    await old.push(row('a', '/checkout'), row('b', '/about'));
    expect(old.ids(0)).toEqual(['a', 'b']);
    const bare = harness(() => '/about');
    await bare.push(row('c'), row('d', ''));
    expect(bare.ids(0)).toEqual(['c', 'd']);
  });

  it('compares against the route at each snapshot', async () => {
    let here = '/checkout';
    const h = harness(() => here);
    await h.push(row('a', '/checkout'), row('b', '/about'));
    expect(h.ids(0)).toEqual(['a']);
    here = '/about';
    await h.push(row('a', '/checkout'), row('b', '/about'));
    expect(h.ids(1)).toEqual(['b']);
    await h.push(row('a', '/checkout'), row('b', '/about'));
    expect(h.ids(2)).toEqual(['b']);
  });

  it('restores nothing and keeps working when the route call throws', async () => {
    const h = harness(() => {
      throw new Error('boom');
    });
    await h.push(row('a', '/checkout'));
    expect(h.restore).not.toHaveBeenCalled();
  });

  it('answers the route pattern the collector records for a mark', () => {
    window.history.pushState({}, '', '/orders/42');
    const c = collect({ win: window, hot: { send() {}, on() {} }, onStatus() {} });
    expect(c.route!()).toBe('/orders/:id');
    c.dispose();
  });
});
