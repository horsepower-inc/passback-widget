import type { Offset } from '@passback/schema';

export const KEPT_MAX = 20; // section 1: at most 20 marks per batch

export type Dest = 'agent' | 'tracker';

export type KeptComment = {
  element: Element;
  selector: string;
  offset: Offset;
  comment: string;
  dest?: Dest;
};

export const destOf = (item: { dest?: Dest }): Dest => item.dest ?? 'agent';

export type Kept<T extends KeptComment = KeptComment> = { readonly items: readonly T[] };

export type KeptEvent<T extends KeptComment = KeptComment> =
  | { type: 'add'; item: T }
  | { type: 'remove'; n: number }
  | { type: 'dest'; n: number; dest: Dest }
  | { type: 'clear'; dest?: Dest };

export function emptyKept<T extends KeptComment = KeptComment>(): Kept<T> {
  return { items: [] };
}

export function keptFull(state: Kept): boolean {
  return state.items.length >= KEPT_MAX;
}

function setDest<T extends KeptComment>(state: Kept<T>, n: number, dest: Dest): Kept<T> {
  if (!Number.isInteger(n) || n < 1 || n > state.items.length) return state;
  if (destOf(state.items[n - 1]!) === dest) return state;
  return { items: state.items.map((item, i) => (i === n - 1 ? { ...item, dest } : item)) };
}

function clearDest<T extends KeptComment>(state: Kept<T>, dest?: Dest): Kept<T> {
  if (dest === undefined) return state.items.length === 0 ? state : { items: [] };
  const items = state.items.filter((item) => destOf(item) !== dest);
  return items.length === state.items.length ? state : { items };
}

export function keptReducer<T extends KeptComment>(state: Kept<T>, event: KeptEvent<T>): Kept<T> {
  switch (event.type) {
    case 'add':
      if (keptFull(state) || event.item.comment.trim() === '') return state;
      return { items: [...state.items, event.item] };
    case 'remove': {
      const { n } = event;
      if (!Number.isInteger(n) || n < 1 || n > state.items.length) return state;
      return { items: state.items.filter((_, i) => i !== n - 1) };
    }
    case 'dest':
      return setDest(state, event.n, event.dest);
    case 'clear':
      return clearDest(state, event.dest);
  }
}

export function numbered<T extends KeptComment>(state: Kept<T>): Array<{ n: number; item: T }> {
  return state.items.map((item, i) => ({ n: i + 1, item }));
}
