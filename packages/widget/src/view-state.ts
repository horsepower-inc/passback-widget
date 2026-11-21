export type ViewSnapshot = { route: string; scrollX: number; scrollY: number };

export type ViewRestore = { kind: 'restored' } | { kind: 'reset'; route: string; message: string };

function routeOf(location: Pick<Location, 'pathname' | 'search' | 'hash'>): string {
  return location.pathname + location.search + location.hash;
}

export function captureView(win: Pick<Window, 'location' | 'scrollX' | 'scrollY'>): ViewSnapshot {
  return {
    route: routeOf(win.location),
    scrollX: win.scrollX,
    scrollY: win.scrollY,
  };
}

export function restoreView(
  win: Pick<Window, 'location' | 'scrollTo'>,
  snapshot: ViewSnapshot,
): ViewRestore {
  const route = routeOf(win.location);
  if (route !== snapshot.route) {
    return {
      kind: 'reset',
      route: snapshot.route,
      message: 'state reset — re-navigate to ' + snapshot.route,
    };
  }
  try {
    win.scrollTo(snapshot.scrollX, snapshot.scrollY);
  } catch {
    // the overlay never throws into the host page
  }
  return { kind: 'restored' };
}
