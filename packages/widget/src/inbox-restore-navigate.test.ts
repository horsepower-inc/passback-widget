// @vitest-environment happy-dom
import { expect, it, onTestFinished, vi } from 'vitest';
import { collect, type Collector } from './collect';
import { ROUTE_SETTLE_MS, watchInbox } from './inbox-restore';

type Cb = (data: unknown) => void;
const row = (id: string, route: string) => ({
  ...{ id, status: 'new', comment: 'c', iterations: [] },
  ...{ selector: `[data-testid="${id}"]`, target: { tag: 'button', text: id }, route },
});
const both = [row('checkout', '/checkout'), row('about', '/about')];

async function harness({ throws = false } = {}) {
  vi.useFakeTimers();
  const handlers = new Map<string, Cb>();
  const hot = { send: vi.fn(), on: (e: string, cb: Cb) => void handlers.set(e, cb), off: vi.fn() };
  const win = { __passback: { hot, caps: ['list'] }, document: {} } as unknown as Window;
  let [here, fire, hold] = ['/checkout', () => {}, Promise.resolve()];
  const [off, live, restore] = [vi.fn(), new Set(['checkout']), vi.fn()];
  const onRoute = vi.fn((cb: () => void) => {
    if (throws) throw new Error('no history');
    return ((fire = cb), off);
  });
  const reresolve = (_d: unknown, t: { selectors: { value: string }[] }) =>
    live.has(/"(.*)"/.exec(t.selectors[0]!.value)![1]!) ? { element: {}, via: 'testid' } : null;
  const collector = { route: () => here, onRoute, reresolve } as unknown as Collector;
  const stop = watchInbox({ win, ensureCollector: () => hold.then(() => collector), restore });
  const push = (...items: unknown[]) => handlers.get('passback:items')?.({ v: 1, items });
  onTestFinished(() => void [stop(), vi.useRealTimers()]);
  push(...both);
  await wait();
  return {
    ...{ push, restore, stop, off, onRoute, live, fire: () => fire() },
    log: () => restore.mock.calls.map(([e]) => (e as { id: string }[]).map((x) => x.id)),
    move: (to: string) => void ((here = to), fire()),
    block: () => new Promise<() => void>((r) => void (hold = new Promise((h) => r(h)))),
  };
}
const wait = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

it('runs the restore again when the route changes and drops the marks of the page left', async () => {
  const h = await harness();
  h.move('/about');
  await wait();
  expect([h.log(), h.onRoute.mock.calls.length]).toEqual([[['checkout'], []], 1]);
});

it('runs once more after the settle delay so the marks of the new page appear', async () => {
  const h = await harness();
  h.move('/about');
  await wait();
  h.fire();
  await wait(ROUTE_SETTLE_MS - 1);
  h.live.add('about');
  await wait(1);
  expect(h.log()).toEqual([['checkout'], [], [], ['about']]);
  await wait(ROUTE_SETTLE_MS * 2);
  expect(h.log()).toHaveLength(4);
});

it('leaves content that renders after the delay to the next snapshot', async () => {
  const h = await harness();
  h.move('/about');
  await wait(ROUTE_SETTLE_MS);
  h.live.add('about');
  await wait(ROUTE_SETTLE_MS * 2);
  expect(h.log()).toEqual([['checkout'], [], []]);
  h.push(...both, row('more', '/about'));
  await wait();
  expect(h.log().at(-1)).toEqual(['about']);
});

it('drops a run overtaken by a route change while it waits for the collector', async () => {
  const h = await harness();
  const release = await h.block();
  h.push(...both, row('more', '/checkout'));
  h.live.add('about');
  h.move('/about');
  release();
  await wait();
  expect(h.log()).toEqual([['checkout'], ['about']]);
});

it('keeps the snapshot path working when onRoute throws', async () => {
  const h = await harness({ throws: true });
  h.push(...both, row('more', '/checkout'));
  await wait(ROUTE_SETTLE_MS);
  expect([h.onRoute.mock.calls.length, h.log().length]).toEqual([1, 2]);
});

it('stops listening for route changes when the watch stops', async () => {
  const h = await harness();
  h.fire();
  h.stop();
  expect(h.off).toHaveBeenCalledTimes(1);
  h.fire();
  await wait(ROUTE_SETTLE_MS * 2);
  expect(h.log()).toHaveLength(1);
});

it('reports a route change from pushState and popstate and stays quiet on the same route', () => {
  const [pushState, replaceState] = [history.pushState, history.replaceState];
  const c = collect({ win: window, onStatus: () => {} });
  const [cb, first, second] = [vi.fn(), vi.fn(), vi.fn()];
  const stop = c.onRoute!(cb);
  history.pushState({}, '', '/about');
  history.replaceState({}, '', '/about');
  history.pushState({}, '', '/about?x=1#h');
  window.location.hash = '#other';
  window.dispatchEvent(new Event('popstate'));
  expect(cb).toHaveBeenCalledTimes(1);
  pushState.call(history, {}, '', '/back');
  window.dispatchEvent(new Event('popstate'));
  stop();
  [c.onRoute!(first), c.onRoute!(second)][0]!();
  c.dispose();
  history.pushState({}, '', '/last');
  expect([cb, first, second].map((f) => f.mock.calls.length)).toEqual([2, 0, 0]);
  expect([history.pushState, history.replaceState]).toEqual([pushState, replaceState]);
});
