declare const __PB_LOCAL__: boolean;

/** What the window inbox store offers the numbers; the store's own type lives in inbox-store.ts. */
export type NumberStore = {
  rows(): readonly { id: string }[];
  numberOf(id: string): number | undefined;
  subscribe(cb: () => void): unknown;
};

export function storeOf(win: Window): NumberStore | undefined {
  try {
    const store = (win as unknown as { __passback?: { inbox?: Partial<NumberStore> } }).__passback
      ?.inbox;
    const ok =
      store &&
      typeof store.rows === 'function' &&
      typeof store.numberOf === 'function' &&
      typeof store.subscribe === 'function';
    return ok ? (store as NumberStore) : undefined;
  } catch {
    return undefined;
  }
}

/** The list number of an inbox row; undefined without a store, for a row without one, or on a throw. */
export function rowNumber(win: Window, id: string): number | undefined {
  try {
    return storeOf(win)?.numberOf(id);
  } catch {
    return undefined;
  }
}

/** How many inbox rows carry a list number: the kept comments continue after them. */
export function keptOffset(win: Window): number {
  if (typeof __PB_LOCAL__ !== 'undefined' && !__PB_LOCAL__) return 0;
  try {
    const store = storeOf(win);
    return store ? store.rows().filter((r) => store.numberOf(r.id) !== undefined).length : 0;
  } catch {
    return 0;
  }
}
