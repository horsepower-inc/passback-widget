// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMPLETION_ATTR, Celebration, completionRules } from './completion';
import { celebrate } from './fx';
import { createDot, type DotState } from './dot-view';
import { moveStamp, showStamp, stampRules } from './stamp';
import { styleSheet } from './styles';
import { TOKENS } from './tokens';

function shadow(): ShadowRoot {
  return document.createElement('div').attachShadow({ mode: 'open' });
}

function fold(text: string): string {
  return text.replace(/\s+/g, ' ');
}

function stampRule(): string {
  const match = /\.pb-stamp \{[^}]*\}/.exec(stampRules());
  return match ? match[0] : '';
}

describe('stamp', () => {
  it('writes Fixed and a check mark and hides the stamp from screen readers', () => {
    const root = shadow();
    const stamp = showStamp(root, { x: 0, y: 0 });
    expect(stamp.textContent).toBe('Fixed ✓');
    expect(stamp.getAttribute('aria-hidden')).toBe('true');
    expect(stamp.className).toBe('pb-stamp');
    expect(stamp.parentNode).toBe(root);
  });

  it('puts the stamp 22px right of and 14px above the pin', () => {
    const stamp = showStamp(shadow(), { x: 100, y: 50 });
    expect(stamp.style.left).toBe('122px');
    expect(stamp.style.top).toBe('36px');
    moveStamp(stamp, { x: 10, y: 20 });
    expect(stamp.style.left).toBe('32px');
    expect(stamp.style.top).toBe('6px');
  });

  it('removes the stamp when its animation ends', () => {
    const root = shadow();
    const stamp = showStamp(root, { x: 0, y: 0 });
    stamp.dispatchEvent(new Event('animationend'));
    expect(root.contains(stamp)).toBe(false);
  });

  it('styles the stamp as bold italic capitals over a shadow in the fixed colour', () => {
    const rule = stampRule();
    expect(rule).toContain('font: italic 900 20px/1 system-ui, sans-serif');
    expect(rule).toContain('text-transform: uppercase');
    expect(rule).toContain('color: var(--pb-color-surface)');
    expect(rule).toContain('text-shadow: 2px 2px 0 var(--pb-color-ok)');
    expect(rule).toContain('pointer-events: none');
    expect(rule).toContain('white-space: nowrap');
  });

  it('pops the stamp tilted 8 degrees and fades it out within the stamp time', () => {
    const rule = stampRule();
    expect(rule).toContain(
      'animation: pb-stamp var(--pb-motion-stamp) var(--pb-motion-ease) forwards',
    );
    expect(rule).toContain('transform-origin: 0 100%');
    const frames = /@keyframes pb-stamp \{([\s\S]*?)\n\}/.exec(stampRules())?.[1] ?? '';
    const steps = [...frames.matchAll(/(\d+)% \{([^}]*)\}/g)];
    expect(steps.map((s) => s[1])).toEqual(['0', '12', '80', '100']);
    for (const step of steps) expect(step[2]).toContain('rotate(-8deg)');
    expect(steps[0]?.[2]).toContain('scale(1.7)');
    expect(steps[0]?.[2]).toContain('opacity: 0');
    expect(steps[3]?.[2]).toContain('opacity: 0');
    expect(TOKENS['--pb-motion-stamp']).toBe('1.8s');
  });

  it('does not show the stamp under reduced motion', () => {
    expect(fold(stampRules())).toContain(
      '@media (prefers-reduced-motion: reduce) { .pb-stamp { display: none; } }',
    );
  });

  it('is part of the widget stylesheet', () => {
    expect(styleSheet()).toContain(stampRules());
  });
});

describe('stamp on the pin', () => {
  function stamps(root: ShadowRoot): Element[] {
    return [...root.querySelectorAll('.pb-stamp')];
  }

  it('pops one stamp beside the pin when the pin turns fixed', () => {
    const root = shadow();
    const dot = createDot(root, { x: 100, y: 50 });
    dot.setState('running');
    dot.setState('done');
    const found = stamps(root);
    expect(found).toHaveLength(1);
    const stamp = found[0] as HTMLElement;
    expect(stamp.style.left).toBe('122px');
    expect(stamp.style.top).toBe('36px');
    expect(dot.element.getAttribute('data-state')).toBe('done');
    expect(dot.element.textContent).toBe('1');
  });

  it('pops no second stamp when fixed arrives again', () => {
    const root = shadow();
    const dot = createDot(root, { x: 100, y: 50 });
    dot.setState('done');
    const first = stamps(root)[0];
    dot.setState('done');
    expect(stamps(root)).toHaveLength(1);
    expect(stamps(root)[0]).toBe(first);
  });

  it('shows no stamp for a pin in any other state', () => {
    const others: DotState[] = ['pinned', 'sending', 'queued', 'running', 'failed', 'orphaned'];
    for (const state of others) {
      const root = shadow();
      const dot = createDot(root, { x: 1, y: 2 });
      dot.setState(state);
      expect(stamps(root)).toHaveLength(0);
    }
  });

  it('takes the stamp away when the pin leaves the fixed state', () => {
    const root = shadow();
    const dot = createDot(root, { x: 100, y: 50 });
    dot.setState('done');
    dot.setState('running');
    expect(stamps(root)).toHaveLength(0);
    dot.setState('done');
    expect(stamps(root)).toHaveLength(1);
  });

  it('takes the stamp away when the pin is removed', () => {
    const root = shadow();
    const dot = createDot(root, { x: 100, y: 50 });
    dot.setState('done');
    dot.remove();
    expect(stamps(root)).toHaveLength(0);
    expect(root.querySelector('.pb-dot')).toBeNull();
  });

  it('moves a showing stamp with its pin', () => {
    const root = shadow();
    const dot = createDot(root, { x: 100, y: 50 });
    dot.setState('done');
    dot.moveTo({ x: 10, y: 20 });
    const stamp = stamps(root)[0] as HTMLElement;
    expect(stamp.style.left).toBe('32px');
    expect(stamp.style.top).toBe('6px');
  });

  it('leaves the number on the pin once the stamp has gone', () => {
    const root = shadow();
    const dot = createDot(root, { x: 100, y: 50 });
    dot.setState('done');
    (stamps(root)[0] as Element).dispatchEvent(new Event('animationend'));
    expect(stamps(root)).toHaveLength(0);
    expect(dot.element.getAttribute('data-state')).toBe('done');
    expect(dot.element.textContent).toBe('1');
    expect(() => dot.moveTo({ x: 5, y: 5 })).not.toThrow();
    expect(() => dot.remove()).not.toThrow();
  });
});

describe('stamp containment', () => {
  const VW = 1024;
  const VH = 768;
  const scope = globalThis as { __passback?: unknown };
  type Pose = { deg: number; scale: number };
  type At = { x: number; y: number };

  // Every pose the stamp can show: the pb-stamp keyframes and the static completion pose.
  function posesOf(css: string): Pose[] {
    const found = css.matchAll(/transform: rotate\((-?[\d.]+)deg\)(?: scale\(([\d.]+)\))?/g);
    return [...found].map((m) => ({ deg: Number(m[1]), scale: m[2] ? Number(m[2]) : 1 }));
  }
  const frames = /@keyframes pb-stamp \{([\s\S]*?)\n\}/.exec(stampRules())?.[1] ?? '';
  const POSES = [...posesOf(frames), ...posesOf(completionRules())];
  const font = (el: Element): number => (el.getAttribute(COMPLETION_ATTR) === 'sent' ? 12 : 20);
  const isStamp = (el: HTMLElement): boolean => el.isConnected && el.classList.contains('pb-stamp');

  beforeEach(async () => {
    await document.fonts?.ready;
    // A real browser measures zero until the stamp is attached; size follows final text and font.
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return isStamp(this) ? Math.ceil((this.textContent ?? '').length * font(this) * 0.7) : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return isStamp(this) ? font(this) : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
      this: Element,
    ) {
      return this === this.ownerDocument.documentElement ? VW : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
      this: Element,
    ) {
      return this === this.ownerDocument.documentElement ? VH : 0;
    });
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete scope.__passback;
    document.body.replaceChildren();
  });

  function attached(): ShadowRoot {
    return document.body.appendChild(document.createElement('div')).attachShadow({ mode: 'open' });
  }
  function registerEffects(): void {
    scope.__passback = {
      fx: { celebrate: (...a: ConstructorParameters<typeof Celebration>) => new Celebration(...a) },
    };
  }
  function only(root: ShadowRoot): HTMLElement {
    const found = root.querySelectorAll<HTMLElement>('.pb-stamp');
    expect(found).toHaveLength(1);
    return found[0] as HTMLElement;
  }

  // The rendered box of one pose around the bottom-left transform origin.
  function box(stamp: HTMLElement, pose: Pose) {
    const w = stamp.offsetWidth;
    const h = stamp.offsetHeight;
    const ox = Number.parseFloat(stamp.style.left);
    const oy = Number.parseFloat(stamp.style.top) + h;
    const a = (pose.deg * Math.PI) / 180;
    const pts = [
      [0, 0],
      [w, 0],
      [0, -h],
      [w, -h],
    ].map(([x, y]) => [x! * pose.scale, y! * pose.scale] as const);
    const xs = pts.map(([x, y]) => ox + x * Math.cos(a) - y * Math.sin(a));
    const ys = pts.map(([x, y]) => oy + x * Math.sin(a) + y * Math.cos(a));
    return { l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys) };
  }
  function contained(stamp: HTMLElement): void {
    expect(stamp.offsetWidth).toBeGreaterThan(0);
    expect(stamp.offsetHeight).toBeGreaterThan(0);
    for (const pose of POSES) {
      const b = box(stamp, pose);
      expect(b.l).toBeGreaterThanOrEqual(-1);
      expect(b.t).toBeGreaterThanOrEqual(-1);
      expect(b.r).toBeLessThanOrEqual(VW + 1);
      expect(b.b).toBeLessThanOrEqual(VH + 1);
    }
  }

  const corners = [
    { x: 30, y: 30, right: true, down: true },
    { x: VW - 30, y: 30, right: false, down: true },
    { x: 30, y: VH - 30, right: true, down: false },
    { x: VW - 30, y: VH - 30, right: false, down: false },
  ];
  function opensToPage(stamp: HTMLElement, c: (typeof corners)[number]): void {
    contained(stamp);
    const left = Number.parseFloat(stamp.style.left);
    const top = Number.parseFloat(stamp.style.top);
    if (c.right) expect(left).toBeGreaterThan(c.x - 1);
    else expect(left + stamp.offsetWidth).toBeLessThanOrEqual(c.x + 1);
    if (c.down) expect(top).toBeGreaterThan(c.y - 1);
    // Upward: the stamp sits above the anchor it rises from.
    else expect(top + stamp.offsetHeight / 2).toBeLessThan(c.y);
  }

  it('reads every stamp pose from the stylesheets', () => {
    expect(stampRule()).toContain('transform-origin: 0 100%');
    expect(POSES).toContainEqual({ deg: -8, scale: 1.7 });
    expect(POSES).toContainEqual({ deg: -8, scale: 1 });
    expect(POSES.length).toBeGreaterThanOrEqual(5);
    expect(fold(completionRules())).toContain(
      `[${COMPLETION_ATTR}="sent"] { animation-delay: 0s; font-size: 12px; }`,
    );
  });

  it('opens Sent toward the page at all launcher corners', () => {
    const dot = document.createElement('div');
    for (const c of corners) {
      // Registered effects chunk: the real completion celebration and its final styling.
      registerEffects();
      const root = attached();
      const made = celebrate(root, dot, 'sent', c);
      const stamp = only(root);
      expect(stamp.textContent).toBe('SENT!');
      expect(stamp.getAttribute(COMPLETION_ATTR)).toBe('sent');
      expect(stamp.getAttribute('aria-hidden')).toBe('true');
      opensToPage(stamp, c);
      made.remove();
      expect(root.querySelector('.pb-stamp')).toBeNull();
      // Existing fallback, without the effects chunk.
      delete scope.__passback;
      const bare = attached();
      const plain = celebrate(bare, dot, 'sent', c);
      const fallback = only(bare);
      expect(fallback.textContent).toBe('SENT!');
      opensToPage(fallback, c);
      plain.remove();
      expect(bare.querySelector('.pb-stamp')).toBeNull();
    }
  });

  it('contains stamps placed and moved near every viewport edge', () => {
    const spots: At[] = [
      { x: 0, y: 0 },
      { x: VW, y: 0 },
      { x: 0, y: VH },
      { x: VW, y: VH },
      { x: VW / 2, y: 0 },
      { x: VW / 2, y: VH },
      { x: 0, y: VH / 2 },
      { x: VW, y: VH / 2 },
    ];
    // Fixed placed directly at each edge, then moved along all of them twice.
    for (const at of spots) {
      const root = attached();
      const stamp = showStamp(root, at);
      expect(stamp.textContent).toBe('Fixed ✓');
      contained(stamp);
      for (const to of spots) {
        moveStamp(stamp, to);
        contained(stamp);
        const once = [stamp.style.left, stamp.style.top];
        moveStamp(stamp, to);
        expect([stamp.style.left, stamp.style.top]).toEqual(once);
      }
    }
    // Sent through the registered effects, with its final 12px text, moved along every edge.
    registerEffects();
    const root = attached();
    const made = celebrate(root, document.createElement('div'), 'sent', spots[3]!);
    const sent = only(root);
    contained(sent);
    for (const to of spots) {
      made.move(to);
      contained(sent);
    }
    made.remove();
    // A fitting interior position keeps the usual offset.
    const stamp = showStamp(attached(), { x: 500, y: 400 });
    expect(stamp.style.left).toBe('522px');
    expect(stamp.style.top).toBe('386px');
    moveStamp(stamp, { x: 300, y: 300 });
    expect(stamp.style.left).toBe('322px');
    expect(stamp.style.top).toBe('286px');
    const inner = attached();
    const interior = celebrate(inner, document.createElement('div'), 'sent', { x: 500, y: 400 });
    expect(only(inner).style.left).toBe('522px');
    expect(only(inner).style.top).toBe('386px');
    interior.remove();
  });

  it('contains reduced-motion stamps without changing their lifetime', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as MediaQueryList);
    const corner = { x: VW - 30, y: VH - 30 };
    for (const effects of [true, false]) {
      if (effects) registerEffects();
      else delete scope.__passback;
      const root = attached();
      const made = celebrate(root, document.createElement('div'), 'sent', corner);
      const stamp = only(root);
      if (effects) expect(stamp.hasAttribute('data-pb-static')).toBe(true);
      contained(stamp);
      made.move({ x: 20, y: 20 });
      contained(stamp);
      vi.advanceTimersByTime(1799);
      expect(root.contains(stamp)).toBe(true);
      vi.advanceTimersByTime(2);
      expect(root.contains(stamp)).toBe(false);
    }
  });

  it('contains fallback stamps when effects fail and removes them on disposal', () => {
    scope.__passback = {
      fx: {
        celebrate: () => {
          throw new Error('chunk failed');
        },
      },
    };
    const root = attached();
    const dot = document.createElement('div');
    const a = celebrate(root, dot, 'done', { x: VW - 10, y: 10 });
    const b = celebrate(root, dot, 'sent', { x: 10, y: VH - 10 });
    const found = [...root.querySelectorAll<HTMLElement>('.pb-stamp')];
    expect(found.map((s) => s.textContent)).toEqual(['FIXED ✓', 'SENT!']);
    for (const s of found) contained(s);
    a.remove();
    expect(root.querySelectorAll('.pb-stamp')).toHaveLength(1);
    b.remove();
    expect(root.querySelectorAll('.pb-stamp')).toHaveLength(0);
    // The real celebration whose flight cannot start falls back to the static pose, still contained.
    registerEffects();
    const shell = attached();
    const made = celebrate(shell, dot, 'done', { x: VW - 10, y: VH - 10 });
    vi.advanceTimersByTime(20);
    const still = only(shell);
    expect(still.hasAttribute('data-pb-static')).toBe(true);
    expect(still.textContent).toBe('FIXED ✓');
    contained(still);
    made.remove();
    expect(shell.querySelector('.pb-stamp')).toBeNull();
    expect(shell.querySelector('.pb-cb-fx')).toBeNull();
  });
});
