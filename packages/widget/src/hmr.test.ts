import { describe, expect, it, vi } from 'vitest';
import { watchHmr, type Hot } from './hmr';
import type { OpenMark, Reattached } from './reattach';
import type { ViewRestore } from './view-state';

type FakeWindow = {
  location: Location;
  scrollX: number;
  scrollY: number;
  scrollTo: Window['scrollTo'];
  calls: Array<[number, number]>;
};

function fakeWindow(
  route: { pathname: string; search: string; hash: string },
  scrollX: number,
  scrollY: number,
): FakeWindow {
  const calls: Array<[number, number]> = [];
  return {
    location: { ...route } as Location,
    scrollX,
    scrollY,
    scrollTo: ((x: number, y: number) => {
      calls.push([x, y]);
    }) as Window['scrollTo'],
    calls,
  };
}

type FakeHot = Hot & {
  handlers: Map<string, Set<(payload?: unknown) => void>>;
  emit(event: string, payload?: unknown): void;
};

function fakeHot(): FakeHot {
  const handlers = new Map<string, Set<(payload?: unknown) => void>>();
  return {
    handlers,
    on(event, cb) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)?.add(cb);
    },
    off(event, cb) {
      handlers.get(event)?.delete(cb);
    },
    emit(event, payload) {
      for (const cb of handlers.get(event) ?? []) cb(payload);
    },
  };
}

describe('watchHmr', () => {
  it('captures on beforeUpdate and restores after afterUpdate on the same route', () => {
    const hot = fakeHot();
    const win = fakeWindow({ pathname: '/a/b', search: '', hash: '' }, 10, 20);
    const mark: OpenMark = { id: 'm1' };
    const element = {} as Element;
    const restoredCalls: Array<[Reattached<OpenMark>[], ViewRestore]> = [];

    watchHmr({
      hot,
      win,
      marks: () => [mark],
      resolve: () => element,
      onRestored: (results, view) => restoredCalls.push([results, view]),
      defer: (run) => run(),
    });

    hot.emit('vite:beforeUpdate');
    hot.emit('vite:afterUpdate');

    expect(restoredCalls).toEqual([[[{ mark, element, orphaned: false }], { kind: 'restored' }]]);
    expect(win.calls).toEqual([[10, 20]]);
  });

  it('reports a state reset naming the route when the route changed', () => {
    const hot = fakeHot();
    const win = fakeWindow({ pathname: '/a/b', search: '', hash: '' }, 0, 0);
    const restoredCalls: Array<[Reattached<OpenMark>[], ViewRestore]> = [];

    watchHmr({
      hot,
      win,
      marks: () => [],
      resolve: () => null,
      onRestored: (results, view) => restoredCalls.push([results, view]),
      defer: (run) => run(),
    });

    hot.emit('vite:beforeUpdate');
    win.location = { pathname: '/a/c', search: '', hash: '' } as Location;
    hot.emit('vite:afterUpdate');

    expect(restoredCalls).toEqual([
      [[], { kind: 'reset', route: '/a/b', message: 'state reset — re-navigate to /a/b' }],
    ]);
    expect(win.calls).toEqual([]);
  });

  it('passes orphaned results for marks whose element is gone', () => {
    const hot = fakeHot();
    const win = fakeWindow({ pathname: '/a', search: '', hash: '' }, 0, 0);
    const mark: OpenMark = { id: 'gone' };
    const restoredCalls: Array<[Reattached<OpenMark>[], ViewRestore]> = [];

    watchHmr({
      hot,
      win,
      marks: () => [mark],
      resolve: () => null,
      onRestored: (results, view) => restoredCalls.push([results, view]),
      defer: (run) => run(),
    });

    hot.emit('vite:beforeUpdate');
    hot.emit('vite:afterUpdate');

    expect(restoredCalls[0]?.[0]).toEqual([{ mark, element: null, orphaned: true }]);
  });

  it('ignores afterUpdate with no snapshot', () => {
    const hot = fakeHot();
    const win = fakeWindow({ pathname: '/a', search: '', hash: '' }, 0, 0);
    const onRestored = vi.fn();

    watchHmr({ hot, win, marks: () => [], resolve: () => null, onRestored, defer: (run) => run() });

    hot.emit('vite:afterUpdate');
    expect(onRestored).not.toHaveBeenCalled();

    hot.emit('vite:beforeUpdate');
    hot.emit('vite:afterUpdate');
    expect(onRestored).toHaveBeenCalledTimes(1);

    hot.emit('vite:afterUpdate');
    expect(onRestored).toHaveBeenCalledTimes(1);
  });

  it('defers the reattach until defer runs', () => {
    const hot = fakeHot();
    const win = fakeWindow({ pathname: '/a', search: '', hash: '' }, 0, 0);
    const onRestored = vi.fn();
    const queued: Array<() => void> = [];

    watchHmr({
      hot,
      win,
      marks: () => [],
      resolve: () => null,
      onRestored,
      defer: (run) => queued.push(run),
    });

    hot.emit('vite:beforeUpdate');
    hot.emit('vite:afterUpdate');
    expect(onRestored).not.toHaveBeenCalled();

    queued.forEach((run) => run());
    expect(onRestored).toHaveBeenCalledTimes(1);
  });

  it('a throwing resolver does not escape', () => {
    const hot = fakeHot();
    const win = fakeWindow({ pathname: '/a', search: '', hash: '' }, 0, 0);
    const onRestored = vi.fn();

    watchHmr({
      hot,
      win,
      marks: () => [{ id: 'x' }],
      resolve: () => {
        throw new Error('boom');
      },
      onRestored,
      defer: (run) => run(),
    });

    expect(() => {
      hot.emit('vite:beforeUpdate');
      hot.emit('vite:afterUpdate');
    }).not.toThrow();
    expect(onRestored).toHaveBeenCalledWith(
      [{ mark: { id: 'x' }, element: null, orphaned: true }],
      { kind: 'restored' },
    );
  });

  it('returns a no-op without hot', () => {
    const win = fakeWindow({ pathname: '/a', search: '', hash: '' }, 0, 0);

    const stop = watchHmr({
      hot: undefined,
      win,
      marks: () => [],
      resolve: () => null,
      onRestored: () => {},
    });

    expect(() => stop()).not.toThrow();
  });

  it('stops reacting when stopped', () => {
    const hot = fakeHot();
    const win = fakeWindow({ pathname: '/a', search: '', hash: '' }, 0, 0);
    const onRestored = vi.fn();
    const queued: Array<() => void> = [];

    const stop = watchHmr({
      hot,
      win,
      marks: () => [],
      resolve: () => null,
      onRestored,
      defer: (run) => queued.push(run),
    });

    hot.emit('vite:beforeUpdate');
    hot.emit('vite:afterUpdate');
    stop();
    queued.forEach((run) => run());

    expect(onRestored).not.toHaveBeenCalled();
    expect(hot.handlers.get('vite:beforeUpdate')?.size ?? 0).toBe(0);
    expect(hot.handlers.get('vite:afterUpdate')?.size ?? 0).toBe(0);
    expect(() => stop()).not.toThrow();
  });
});
