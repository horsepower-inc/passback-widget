import type { Offset } from '@passback/schema';

export const KEPT_MAX = 20; // at most 20 marks per batch

export type KeptComment = { element: Element; selector: string; offset: Offset; comment: string };

export type Kept<T extends KeptComment = KeptComment> = { readonly items: readonly T[] };

export type KeptEvent<T extends KeptComment = KeptComment> =
  | { type: 'add'; item: T }
  | { type: 'remove'; n: number }
  | { type: 'clear' };

export function emptyKept<T extends KeptComment = KeptComment>(): Kept<T> {
  return { items: [] };
}

export function keptFull(state: Kept): boolean {
  return state.items.length >= KEPT_MAX;
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
    case 'clear':
      return state.items.length === 0 ? state : { items: [] };
  }
}

export function numbered<T extends KeptComment>(state: Kept<T>): Array<{ n: number; item: T }> {
  return state.items.map((item, i) => ({ n: i + 1, item }));
}
