import type { flyToLauncher } from './fly';
import { moveStamp, showStamp } from './stamp';

type Point = { x: number; y: number };
export type Celebrating = { move(at: Point): void; remove(): void };
export type Fx = {
  celebrate?(root: ShadowRoot, dot: HTMLElement, state: 'sent' | 'done', at: Point): Celebrating;
  fly?: typeof flyToLauncher;
  addons?: Addon[];
};
export type Addon = (ctx: never) => void;

type Scope = { __passback?: { fx?: Fx } };
export const fxOf = (root: Node): Fx =>
  ((root.ownerDocument?.defaultView ?? globalThis) as Scope).__passback?.fx ?? {};

export function attachAddons(ctx: { root: ShadowRoot; host: HTMLElement; doc: Document }): void {
  const { addons } = fxOf(ctx.root);
  if (!addons) return void ctx.doc.addEventListener('passback:fx', () => attachAddons(ctx), { once: true });
  if (ctx.host.isConnected) addons.forEach((addon) => addon(ctx as never));
}

export function celebrate(root: ShadowRoot, dot: HTMLElement, state: 'sent' | 'done', at: Point) {
  try {
    const made = fxOf(root).celebrate?.(root, dot, state, at);
    if (made) return made;
  } catch {
    // The effects chunk must not break the mark; the static stamp stands in.
  }
  const stamp = showStamp(root, at);
  stamp.textContent = state === 'sent' ? 'SENT!' : 'FIXED ✓';
  setTimeout(() => stamp.remove(), 1800);
  return { move: (to: Point) => moveStamp(stamp, to), remove: () => stamp.remove() };
}
