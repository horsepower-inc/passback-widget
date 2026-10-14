/** Tells the relay once that the widget loaded on this page. Resolves the answer's status, or 0
 *  when there was no answer. Never rejects. */
export function pingSeen(endpoint: string, win: Window & typeof globalThis): Promise<number> {
  if (typeof win.fetch !== 'function') return Promise.resolve(0);
  const url = endpoint.replace(/\/+$/, '') + '/seen';
  return win.fetch(url, { method: 'POST', credentials: 'omit' }).then(
    (response) => response.status,
    () => 0,
  );
}
