/** Tells the relay once that the widget loaded on this page. Resolves the answer's status, or 0
 *  when there was no answer. A 200 answer's JSON body is published as
 *  `window.__passback.relay()` and goes to `onBody`, raw. Never rejects. */
export function pingSeen(
  endpoint: string,
  win: Window & typeof globalThis,
  onBody?: (body: unknown) => void,
): Promise<number> {
  if (typeof win.fetch !== 'function') return Promise.resolve(0);
  const url = endpoint.replace(/\/+$/, '') + '/seen';
  return win.fetch(url, { method: 'POST', credentials: 'omit' }).then(
    (response) => {
      const status = response.status;
      if (status !== 200) return status;
      return response.json().then(
        (body: unknown) => {
          const scope = win as { __passback?: Record<string, unknown> };
          scope.__passback = Object.assign(scope.__passback ?? {}, { relay: () => body });
          onBody?.(body);
          return status;
        },
        () => status,
      );
    },
    () => 0,
  );
}
