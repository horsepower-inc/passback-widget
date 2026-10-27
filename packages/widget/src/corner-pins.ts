import type { Dot } from './dot-view';
import type { Kept } from './kept';
import type { KeptPin } from './overlay-marks';
import type { TrackedMark } from './overlay-reattach';

export type PinCtx = {
  root: ShadowRoot;
  host: HTMLElement;
  state: {
    marks: readonly TrackedMark[];
    kept: Kept<KeptPin>;
    dot: Dot | null;
    pinnedElement: Element | null;
  };
};
type Box = { left: number; top: number; right: number; bottom: number };
type Taken = { left: string; top: string };
type Entry = { origin: Taken; set: Taken };

const PIN = 16;
const SMALL = 32;
const LEADER_GAP = 4; // half of --pb-space-gap (8px)
// The leader is ::before; ::after is the status ring of sending, queued and running pins.
const RULES = `
[data-corner-pin] { transform: none; }
[data-corner-pin][hidden] { display: none; }
[data-corner-pin=leader]::before { content: ''; position: absolute; left: 50%; top: 100%; width: 0; height: calc(var(--pb-space-gap) / 2); border-left: thin solid var(--pb-color-main); pointer-events: none; }
[data-corner-pin=leader][data-corner-below]::before { top: auto; bottom: 100%; }
`;
const FLIPS = [
  [false, false],
  [true, false],
  [false, true],
  [true, true],
] as const;
const ATTRS = ['data-corner-pin', 'data-corner-below', 'hidden'];

const usable = (r: Box): boolean =>
  [r.left, r.top, r.right, r.bottom].every(Number.isFinite) && r.right > r.left && r.bottom > r.top;

export function targetOf(ctx: PinCtx, mark: TrackedMark): Element | null {
  const { state } = ctx;
  if (mark.element) return mark.element;
  const kept = state.kept.items.find((item) => item.mark === mark);
  if (kept) return kept.element;
  return state.dot === mark.dot ? state.pinnedElement : null;
}

type Spot = { left: number; top: number; key: string; below: boolean };

function fits(left: number, top: number, r: Box, vw: number, vh: number): boolean {
  const inside = left >= 0 && top >= 0 && left + PIN <= vw && top + PIN <= vh;
  const overlaps = left < r.right && left + PIN > r.left && top < r.bottom && top + PIN > r.top;
  return inside && !overlaps;
}

function spotAt(r: Box, leader: boolean, flipH: boolean, flipV: boolean, slot: number): Spot {
  const key = leader ? `l${flipV}` : `c${flipH}${flipV}`;
  const away = leader === flipH ? -1 : 1;
  const mid = (r.left + r.right) / 2 - PIN / 2;
  const top = leader
    ? flipV
      ? r.bottom + LEADER_GAP
      : r.top - PIN - LEADER_GAP
    : flipV
      ? r.bottom
      : r.top - PIN;
  const left = (leader ? mid : flipH ? r.right : r.left - PIN) + away * slot * PIN;
  return { left, top, key, below: flipV };
}

/** The first of normal, horizontal, vertical, both reflections that fits, with its sideways slot. */
function choose(r: Box, vw: number, vh: number, slots: Map<string, number>): Spot | null {
  const leader = r.right - r.left < SMALL || r.bottom - r.top < SMALL;
  for (const [flipH, flipV] of FLIPS) {
    const probe = spotAt(r, leader, flipH, flipV, 0);
    const spot = spotAt(r, leader, flipH, flipV, slots.get(probe.key) ?? 0);
    if (fits(spot.left, spot.top, r, vw, vh)) {
      slots.set(spot.key, (slots.get(spot.key) ?? 0) + 1);
      return spot;
    }
  }
  return null;
}

/** Collector-chunk add-on: parks each pin just outside its target's corner instead of over the control. */
export function cornerPins(ctx: PinCtx): void {
  const { root, host } = ctx;
  const doc = root.ownerDocument;
  const win = doc.defaultView ?? window;
  const style = doc.createElement('style');
  style.setAttribute('data-pb-corner-pins-styles', '');
  style.textContent = RULES;
  root.append(style);
  const taken = new Map<HTMLElement, Entry>();

  const restore = (el: HTMLElement): void => {
    const entry = taken.get(el);
    if (entry === undefined) return;
    el.style.left = entry.origin.left;
    el.style.top = entry.origin.top;
    ATTRS.forEach((name) => el.removeAttribute(name));
    taken.delete(el);
  };

  const place = (el: HTMLElement, target: Element, slots: Map<string, number>): void => {
    const r = target.getBoundingClientRect();
    const { innerWidth: vw, innerHeight: vh } = win;
    if (!usable(r) || !(vw > 0 && vh > 0)) return restore(el);
    const prior = taken.get(el);
    const own = prior && el.style.left === prior.set.left && el.style.top === prior.set.top;
    // A point the core wrote since our last pass is the new place to fall back to.
    const origin = own ? prior.origin : { left: el.style.left, top: el.style.top };
    const found = choose(r, vw, vh, slots);
    const set = found
      ? { left: `${found.left}px`, top: `${found.top}px` }
      : { left: el.style.left, top: el.style.top };
    el.style.left = set.left;
    el.style.top = set.top;
    el.setAttribute(
      'data-corner-pin',
      r.right - r.left < SMALL || r.bottom - r.top < SMALL ? 'leader' : 'corner',
    );
    el.toggleAttribute(
      'data-corner-below',
      el.dataset.cornerPin === 'leader' && found?.below === true,
    );
    el.toggleAttribute('hidden', found === null);
    taken.set(el, { origin, set });
  };

  const pass = (): void => {
    const live = new Set<HTMLElement>();
    const groups = new Map<Element, Map<string, number>>();
    for (const mark of ctx.state.marks) {
      const el = mark.dot.element;
      live.add(el);
      // Every dot is watched, so a reattachment after a fallback places its pin again.
      styleWatch.observe(el, { attributes: true, attributeFilter: ['style'] });
      try {
        const target = targetOf(ctx, mark);
        if (!target?.isConnected) restore(el);
        else {
          const slots = groups.get(target) ?? new Map<string, number>();
          groups.set(target, slots);
          place(el, target, slots);
        }
      } catch {
        // A failing pin must not reach the host page or stop the others.
        restore(el);
      }
    }
    for (const el of [...taken.keys()]) if (!live.has(el)) restore(el);
  };

  // Our own writes match what we last set; a restored dot settles after one more pass.
  const moved = (records: MutationRecord[]): void => {
    for (const { target } of records) {
      const el = target as HTMLElement;
      const set = taken.get(el)?.set;
      if (!set || el.style.left !== set.left || el.style.top !== set.top) return pass();
    }
  };
  const tree = new MutationObserver(pass);
  const styleWatch = new MutationObserver(moved);
  tree.observe(root, { childList: true });
  const dispose = (): void => {
    tree.disconnect();
    styleWatch.disconnect();
    win.removeEventListener('scroll', pass, true);
    win.removeEventListener('resize', pass);
    host.removeEventListener('passback:dispose', dispose);
    for (const el of [...taken.keys()]) restore(el);
    style.remove();
  };
  win.addEventListener('scroll', pass, true);
  win.addEventListener('resize', pass);
  host.addEventListener('passback:dispose', dispose);
  pass();
}
