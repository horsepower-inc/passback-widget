import { describe, expect, it } from 'vitest';
import { captureView, restoreView, type ViewSnapshot } from './view-state';

type FakeCaptureWindow = Pick<Window, 'location' | 'scrollX' | 'scrollY'>;
type FakeRestoreWindow = Pick<Window, 'location' | 'scrollTo'>;

function fakeLocation(pathname: string, search: string, hash: string) {
  return { pathname, search, hash } as Location;
}

function fakeCaptureWindow(
  route: { pathname: string; search: string; hash: string },
  scrollX: number,
  scrollY: number,
): FakeCaptureWindow {
  return { location: fakeLocation(route.pathname, route.search, route.hash), scrollX, scrollY };
}

function fakeRestoreWindow(
  route: { pathname: string; search: string; hash: string },
  scrollTo: (x: number, y: number) => void,
): FakeRestoreWindow {
  return {
    location: fakeLocation(route.pathname, route.search, route.hash),
    scrollTo: scrollTo as Window['scrollTo'],
  };
}

describe('captureView', () => {
  it('captureView records the route with its query and hash and the scroll position', () => {
    const win = fakeCaptureWindow({ pathname: '/a/b', search: '?q=1', hash: '#top' }, 20, 300);

    expect(captureView(win)).toEqual({ route: '/a/b?q=1#top', scrollX: 20, scrollY: 300 });
  });
});

describe('restoreView', () => {
  it('restoreView scrolls back when the route is unchanged', () => {
    const snapshot: ViewSnapshot = { route: '/a/b?q=1#top', scrollX: 20, scrollY: 300 };
    const calls: Array<[number, number]> = [];
    const win = fakeRestoreWindow({ pathname: '/a/b', search: '?q=1', hash: '#top' }, (x, y) =>
      calls.push([x, y]),
    );

    const result = restoreView(win, snapshot);

    expect(result).toEqual({ kind: 'restored' });
    expect(calls).toEqual([[20, 300]]);
  });

  it('restoreView does not scroll and reports a state reset when the route changed', () => {
    const snapshot: ViewSnapshot = { route: '/a/b?q=1#top', scrollX: 20, scrollY: 300 };
    const calls: Array<[number, number]> = [];
    const win = fakeRestoreWindow({ pathname: '/a/c', search: '', hash: '' }, (x, y) =>
      calls.push([x, y]),
    );

    const result = restoreView(win, snapshot);

    expect(result.kind).toBe('reset');
    expect(calls).toEqual([]);
  });

  it('the reset message names the route to re-navigate to', () => {
    const snapshot: ViewSnapshot = { route: '/a/b?q=1#top', scrollX: 0, scrollY: 0 };
    const win = fakeRestoreWindow({ pathname: '/other', search: '', hash: '' }, () => {});

    const result = restoreView(win, snapshot);

    expect(result).toEqual({
      kind: 'reset',
      route: '/a/b?q=1#top',
      message: 'state reset — re-navigate to /a/b?q=1#top',
    });
  });

  it('a scrollTo that throws does not escape', () => {
    const snapshot: ViewSnapshot = { route: '/a/b', scrollX: 0, scrollY: 0 };
    const win = fakeRestoreWindow({ pathname: '/a/b', search: '', hash: '' }, () => {
      throw new Error('boom');
    });

    expect(() => restoreView(win, snapshot)).not.toThrow();
    expect(restoreView(win, snapshot)).toEqual({ kind: 'restored' });
  });
});
