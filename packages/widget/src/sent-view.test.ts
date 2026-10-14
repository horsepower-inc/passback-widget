// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { createBubble } from './bubble-view';
import { Celebration } from './completion';
import { createDot } from './dot-view';
import { BALL_PATH, createLauncher } from './launcher';
import { styleSheet } from './styles';
import { showStamp } from './stamp';

function shadow(): ShadowRoot {
  return document.body.appendChild(document.createElement('div')).attachShadow({ mode: 'open' });
}

const noop = (): void => undefined;
type Fake = { el: Element; keys: Keyframe[]; onfinish?: () => void } & Record<string, Mock>;
let [frames, anims, reduced, broken] = [[] as FrameRequestCallback[], [] as Fake[], false, false];
const stamps = (root: ShadowRoot): string[] =>
  [...root.querySelectorAll('.pb-stamp')].map(
    (s) => `${s.textContent}${s.hasAttribute('data-pb-static') ? ' static' : ''}`,
  );
const n = (root: ShadowRoot, c: string): number => root.querySelectorAll(`.pb-cb-${c}`).length;
const tick = (): void => frames.splice(0).forEach((cb) => cb(0));
const finish = (i: number): void => anims[i]?.onfinish?.();
const boom = (): void => {
  if (broken) throw new Error('no animations');
};
const BOX = { left: 300, top: 500, width: 36, height: 36 };
function launch(root: ShadowRoot, rect = BOX, vis = ''): void {
  const { element } = createLauncher(root, noop);
  element.getBoundingClientRect = () => rect as DOMRect;
  element.style.visibility = vis;
}
beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as { __passback?: unknown }).__passback = {
    fx: { celebrate: (...a: ConstructorParameters<typeof Celebration>) => new Celebration(...a) },
  };
  [frames, anims, reduced, broken] = [[], [], false, false];
  window.requestAnimationFrame = (cb) => frames.push(cb);
  window.cancelAnimationFrame = (id) => void (frames[id - 1] = noop);
  window.matchMedia = (() => ({ matches: reduced })) as never;
  HTMLElement.prototype.animate = function (this: Element, keys: unknown) {
    boom();
    const fake = { el: this, keys, cancel: vi.fn(boom), setKeyframes: vi.fn() } as unknown as Fake;
    anims.push(fake);
    return Object.assign(fake, { effect: fake }) as never;
  };
});

describe('sent view', () => {
  it('R4b celebrates Sent once and replaces it with Fixed', () => {
    const root = shadow();
    const dot = createDot(root, { x: 5, y: 6 });
    dot.setState('sent');
    dot.setState('sent');
    expect(dot.element.getAttribute('data-state')).toBe('sent');
    expect(dot.element.getAttribute('part')).toBe('pin pin-sent');
    expect(dot.element.getAttribute('aria-label')).toBe('Sent');
    expect(dot.element.querySelectorAll('svg')).toHaveLength(1);
    expect(dot.element.querySelector('path')?.getAttribute('d')).toBe('M2.5 6.5l2.5 2.5 4.5-5.5');
    expect([stamps(root), frames.length]).toEqual([['SENT!'], 1]);

    dot.setState('done');
    expect([stamps(root), frames.filter((f) => f !== noop).length]).toEqual([['FIXED ✓'], 1]);
    dot.setState('running');
    expect([stamps(root), n(root, 'fx')]).toEqual([[], 0]);
  });

  it('shows final Sent without changing agent acknowledgements', () => {
    const root = shadow();
    const bubble = createBubble(root, {
      anchor: { x: 10, y: 20 },
      onSend: noop,
      onCancel: noop,
      onDraw: noop,
      viewportWidth: () => 300,
    });
    expect(bubble.element.hasAttribute('data-docked')).toBe(true);
    bubble.showSent();
    expect(bubble.element.textContent).toBe('Sent!');
    expect(bubble.element.querySelector('textarea, button, a')).toBeNull();
    expect(bubble.element.hasAttribute('data-docked')).toBe(false);
    expect(bubble.element.style.left).toBe('calc(10px + var(--pb-space-gap))');
    expect(bubble.element.style.top).toBe('calc(20px + var(--pb-space-gap))');

    bubble.showAcked('m1', false);
    expect(bubble.element.textContent).toBe('Sent. Waiting for the agent.');
    bubble.showStatus({ state: 'running' });
    expect(bubble.element.textContent).toBe('The agent is working on it.');
    bubble.showStatus({ state: 'done' });
    expect(bubble.element.textContent).toBe('Fixed.');
  });

  it('excludes sent and done from the launcher badge', () => {
    const root = shadow();
    const launcher = createLauncher(root, noop, { corner: 'bottom-right', launcher: 'hidden' });
    const badge = launcher.element.querySelector('span') as HTMLElement;
    launcher.update([
      { lastState: 'sent' },
      { lastState: 'done' },
      { lastState: 'queued' },
      { lastState: 'failed' },
    ]);
    expect(badge.textContent).toBe('2');
    expect(badge.hasAttribute('hidden')).toBe(false);

    launcher.update([{ lastState: 'sent' }, { lastState: 'done' }]);
    expect(badge.textContent).toBe('');
    expect(badge.hasAttribute('hidden')).toBe(true);

    expect(launcher.element.hasAttribute('hidden')).toBe(true);
    launcher.setVisible(true);
    expect(launcher.element.hasAttribute('hidden')).toBe(false);
    launcher.update([]);
    launcher.setVisible(true);
    expect(launcher.element.hasAttribute('hidden')).toBe(true);
  });

  it('R4 styles sent as a popping check and pill without work animation', () => {
    const css = styleSheet().replace(/\s+/g, ' ');
    expect(css).toContain(
      '.pb-dot[data-state="sent"] svg { animation: pb-pop var(--pb-motion-duration) var(--pb-motion-ease) 1; }',
    );
    expect(css).toContain('@keyframes pb-pop');
    expect(css).toContain('.pb-bubble[data-state="sent"] .pb-note[data-role="sent"] {');
    expect(css).toContain('border-radius: var(--pb-space-pad)');
    const ring = css.slice(css.indexOf('.pb-dot[data-state="sending"]::after'));
    expect(ring.slice(0, ring.indexOf('{'))).not.toContain('"sent"');
    const bubble = createBubble(shadow(), {
      anchor: { x: 1, y: 2 },
      onSend: noop,
      onCancel: noop,
      onDraw: noop,
      viewportWidth: () => 900,
    });
    bubble.showSent();
    expect(bubble.element.getAttribute('data-state')).toBe('sent');
    expect(bubble.element.querySelector('[data-role="sent"]')?.textContent).toBe('Sent!');
  });

  it('R4 disables status motion while preserving state icons and text', () => {
    const css = styleSheet().replace(/\s+/g, ' ');
    const reduced = css.slice(
      css.indexOf('@media (prefers-reduced-motion: reduce) { .pb-dot[data-state="sent"] svg'),
    );
    const block = reduced.slice(0, reduced.indexOf('}'));
    expect(block).toContain('.pb-dot[data-state]::after');
    expect(block).toContain('.pb-dot[data-state="sent"] svg');
    expect(block).toContain('animation: none');
    expect(block).not.toContain('display: none');
    const root = shadow();
    const dot = createDot(root, { x: 1, y: 1 });
    dot.setState('sent');
    expect(dot.element.querySelectorAll('svg')).toHaveLength(1);
  });

  it('R4 keeps the Fixed block on the existing stamp lifecycle', () => {
    const css = styleSheet().replace(/\s+/g, ' ');
    const at = css.indexOf('.pb-stamp.pb-stamp {');
    expect(at).toBeGreaterThan(-1);
    const body = css.slice(at, css.indexOf('}', at));
    expect(body).toContain('background: var(--pb-color-ok)');
    expect(body).toContain('border-radius: 0');
    expect(css).toContain(
      'animation: pb-stamp var(--pb-motion-stamp) var(--pb-motion-ease) forwards',
    );
    const root = shadow();
    const stamp = showStamp(root, { x: 1, y: 2 });
    expect(stamp.textContent).toBe('Fixed ✓');
    stamp.dispatchEvent(new Event('animationend'));
    expect(root.querySelector('.pb-stamp')).toBeNull();
  });

  it('R4b shoots the football with three flame streaks and distinct impacts', () => {
    const root = shadow();
    launch(root);
    const dot = createDot(root, { x: 5, y: 6 });
    dot.setState('sent');
    tick();
    const svg = root.querySelector('.pb-cb-shot svg');
    const glyph = [svg?.getAttribute('viewBox'), svg?.firstElementChild?.getAttribute('d')];
    expect([...glyph, n(root, 'streak'), n(root, 'flame')]).toEqual(['0 0 28 28', BALL_PATH, 3, 1]);
    const ends = anims[0]?.keys.map((k) => String(k.transform).match(/-?[\d.]+(?=px)/g));
    expect(ends?.flat().map(Number)).toEqual([318, 518, 5, 6]);
    finish(0);
    expect(['ray', 'ring', 'spark', 'shot'].map((c) => n(root, c))).toEqual([10, 1, 0, 0]);
    const rays = [...root.querySelectorAll<HTMLElement>('.pb-cb-ray')];
    expect(rays.map((r) => parseFloat(r.style.getPropertyValue('--pb-a')))).toEqual(
      [...Array(10).keys()].map((i) => i * 36),
    );
    expect(anims[1]?.el).toBe(dot.element);
    expect(anims[1]?.keys[1]?.transform).toBe('translate(-50%, -50%) scale(1.5)');
    dot.setState('done');
    tick();
    finish(2);
    expect(['ray', 'ring', 'spark'].map((c) => n(root, c))).toEqual([14, 2, 6]);
  });

  it('R4b renders yellow stamps with black shadows in both themes', () => {
    const root = shadow();
    createDot(root, { x: 1, y: 1 }).setState('sent');
    createDot(root, { x: 2, y: 2 }).setState('done');
    const styles = root.querySelectorAll('style[data-pb-completion-styles]');
    const css = styles[0]?.textContent ?? '';
    const rule = (sel: string): string => css.slice(css.indexOf(`${sel} {`)).split('}')[0] ?? '';
    expect([styles.length, styleSheet().split('--pb-color-glow: #ffd400;').length]).toEqual([1, 3]);
    expect(rule('.pb-stamp.pb-stamp[data-pb-celebrate]')).toContain(
      '{ padding: 0; border-radius: 0; background: transparent; color: var(--pb-color-glow); text-shadow: 3px 3px 0 #000;',
    );
    const still = 'display: block; animation: none; opacity: 1; transform: rotate(-8deg);';
    expect(rule('[data-pb-celebrate][data-pb-static]')).toContain(still);
    expect(css.slice(css.indexOf('@media (prefers-reduced-motion'))).toContain(`] { ${still}`);
  });

  it('R4b shows only a static stamp under reduced motion', () => {
    reduced = true;
    const root = shadow();
    launch(root);
    const dot = createDot(root, { x: 5, y: 6 });
    for (const state of ['sent', 'done'] as const) {
      dot.setState(state);
      const text = { sent: 'SENT! static', done: 'FIXED ✓ static' }[state];
      expect([...stamps(root), frames.length + anims.length]).toEqual([text, 0]);
      expect(dot.element.getAttribute('aria-label')).toBe(state === 'sent' ? 'Sent' : 'Fixed');
      vi.advanceTimersByTime(1800);
      expect([stamps(root), n(root, 'fx')]).toEqual([[], 0]);
    }
  });

  it('R4b keeps simultaneous celebrations independent and cleans every exit', () => {
    const root = shadow();
    launch(root);
    const [a, b] = [createDot(root, { x: 5, y: 6 }), createDot(root, { x: 50, y: 60 })];
    a.setState('sent');
    b.setState('done');
    tick();
    a.moveTo({ x: 100, y: 120 });
    const stampA = root.querySelector<HTMLElement>('[data-pb-celebrate="sent"]');
    expect([stampA?.style.left, stampA?.style.top]).toEqual(['122px', '106px']);
    expect(anims[0]?.setKeyframes?.mock.calls[0]?.[0][1].transform).toContain('(100px, 120px)');
    b.setState('failed');
    expect([anims[1]?.cancel?.mock.calls.length, stamps(root)]).toEqual([1, ['SENT!']]);
    finish(0);
    expect(n(root, 'ray')).toBe(10);
    vi.advanceTimersByTime(2220);
    expect([n(root, 'fx'), stamps(root)]).toEqual([0, []]);
    b.setState('done');
    b.remove();
    tick();
    vi.runAllTimers();
    expect([anims.length, n(root, 'fx'), n(root, 'shot'), stamps(root)]).toEqual([3, 0, 0, []]);
  });

  it('R4b falls back to the stamp when the launcher or animation is unavailable', () => {
    const roots = [shadow(), shadow(), shadow()];
    launch(roots[1] as ShadowRoot, { left: 0, top: 0, width: 36, height: 0 });
    launch(roots[2] as ShadowRoot, undefined, 'hidden');
    roots.forEach((r) => createDot(r, { x: 1, y: 1 }).setState('done'));
    expect(() => tick()).not.toThrow();
    expect([roots.flatMap(stamps), anims]).toEqual([Array(3).fill('FIXED ✓ static'), []]);
    const root = shadow();
    launch(root);
    const dot = createDot(root, { x: 1, y: 1 });
    dot.setState('sent');
    tick();
    broken = true;
    expect(() => finish(0)).not.toThrow();
    expect([...stamps(root), n(root, 'shot'), n(root, 'ray')]).toEqual(['SENT! static', 0, 0]);
    dot.setState('done');
    expect(() => tick()).not.toThrow();
    expect(stamps(root)).toEqual(['FIXED ✓ static']);
    vi.advanceTimersByTime(1800);
    expect([...roots, root].flatMap(stamps)).toEqual([]);
  });
});
