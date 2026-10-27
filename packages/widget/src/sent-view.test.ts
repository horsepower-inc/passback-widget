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
  it('R4b shows one small Sent stamp with no flight and no burst, and Fixed replaces it', () => {
    const root = shadow();
    launch(root);
    const dot = createDot(root, { x: 5, y: 6 });
    dot.setState('sent');
    dot.setState('sent');
    expect(dot.element.getAttribute('data-state')).toBe('sent');
    expect(dot.element.getAttribute('part')).toBe('pin pin-sent');
    expect(dot.element.getAttribute('aria-label')).toBe('Sent');
    expect(dot.element.querySelector('svg')).toBeNull();
    expect(dot.element.textContent).toBe('1');
    const fx = ['ray', 'ring', 'spark', 'shot'].map((c) => n(root, c));
    expect([stamps(root), frames.length, anims.length, fx]).toEqual([
      ['SENT!'],
      0,
      0,
      [0, 0, 0, 0],
    ]);

    dot.setState('done');
    expect([stamps(root), frames.filter((f) => f !== noop).length]).toEqual([['FIXED ✓'], 1]);
    dot.setState('running');
    expect([stamps(root), n(root, 'fx')]).toEqual([[], 0]);
  });

  it('R4 hides the bubble while sending and on Sent, and leaves the agent acknowledgements unchanged', () => {
    const root = shadow();
    const opts = { anchor: { x: 10, y: 20 }, onSend: noop, onCancel: noop, onDraw: noop };
    const bubble = createBubble(root, { ...opts, viewportWidth: () => 300 });
    expect(bubble.element.hasAttribute('data-docked')).toBe(true);
    bubble.setPending();
    expect(bubble.element.hidden).toBe(true);
    bubble.showError('boom', noop);
    expect(bubble.element.hidden).toBe(false);
    expect(bubble.element.textContent).toContain('Not sent: boom');
    bubble.destroy();
    const fresh = createBubble(root, { ...opts, viewportWidth: () => 300 });
    fresh.showSent();
    expect(fresh.element.hidden).toBe(true);
    expect(fresh.element.textContent).toBe('');
    expect(fresh.element.querySelector('textarea, button, a')).toBeNull();
    expect(fresh.element.hasAttribute('data-docked')).toBe(false);
    expect(fresh.element.style.left).toBe('calc(10px + var(--pb-space-gap))');
    expect(fresh.element.style.top).toBe('calc(20px + var(--pb-space-gap))');

    bubble.showAcked('m1', false);
    const seen = (): unknown[] => [bubble.element.hidden, bubble.element.textContent];
    expect(seen()).toEqual([false, 'Sent. Waiting for the agent.']);
    bubble.showStatus({ state: 'running' });
    expect(seen()).toEqual([false, 'The agent is working on it.']);
    bubble.showStatus({ state: 'done' });
    expect(seen()).toEqual([false, 'Fixed.']);
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

  it('R4 styles sent as a number with no pill and takes a hidden bubble out of the layout', () => {
    const css = styleSheet().replace(/\s+/g, ' ');
    expect(css).not.toContain('pb-pop');
    expect(css).not.toContain('data-state="sent"] svg');
    expect(css).not.toContain('data-role="sent"');
    expect(css).toContain('.pb-bubble[hidden] { display: none; }');
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
    expect(bubble.element.querySelector('[data-role="sent"]')).toBeNull();
  });

  it('R4 disables status motion while preserving state icons and text', () => {
    const css = styleSheet().replace(/\s+/g, ' ');
    const reduced = css.slice(
      css.indexOf('@media (prefers-reduced-motion: reduce) { .pb-dot[data-state]::after'),
    );
    const block = reduced.slice(0, reduced.indexOf('}'));
    expect(block).toContain('.pb-dot[data-state]::after');
    expect(block).toContain('animation: none');
    expect(block).not.toContain('display: none');
    const root = shadow();
    const dot = createDot(root, { x: 1, y: 1 });
    dot.setState('sent');
    expect(dot.element.querySelector('svg')).toBeNull();
    expect(dot.element.textContent).toBe('1');
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

  it('R4b shoots the football with three flame streaks and distinct impacts for Fixed', () => {
    const root = shadow();
    launch(root);
    const dot = createDot(root, { x: 5, y: 6 });
    dot.setState('done');
    tick();
    const svg = root.querySelector('.pb-cb-shot svg');
    const glyph = [svg?.getAttribute('viewBox'), svg?.firstElementChild?.getAttribute('d')];
    expect([...glyph, n(root, 'streak'), n(root, 'flame')]).toEqual(['0 0 28 28', BALL_PATH, 3, 1]);
    const ends = anims[0]?.keys.map((k) => String(k.transform).match(/-?[\d.]+(?=px)/g));
    expect(ends?.flat().map(Number)).toEqual([318, 518, 5, 6]);
    finish(0);
    expect(anims[1]?.el).toBe(dot.element);
    expect(anims[1]?.keys[1]?.transform).toBe('translate(-50%, -50%) scale(1.5)');
    expect(['ray', 'ring', 'spark', 'shot'].map((c) => n(root, c))).toEqual([14, 2, 6, 0]);
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
    a.setState('done');
    b.setState('sent');
    tick();
    a.moveTo({ x: 100, y: 120 });
    const stampA = root.querySelector<HTMLElement>('[data-pb-celebrate="done"]');
    expect([stampA?.style.left, stampA?.style.top]).toEqual(['122px', '106px']);
    expect(anims[0]?.setKeyframes?.mock.calls[0]?.[0][1].transform).toContain('(100px, 120px)');
    b.setState('failed');
    expect([anims.length, stamps(root)]).toEqual([1, ['FIXED ✓']]);
    finish(0);
    expect(n(root, 'ray')).toBe(14);
    vi.advanceTimersByTime(2220);
    expect([n(root, 'fx'), stamps(root)]).toEqual([0, []]);
    b.setState('done');
    b.remove();
    tick();
    vi.runAllTimers();
    expect([anims.length, n(root, 'fx'), n(root, 'shot'), stamps(root)]).toEqual([2, 0, 0, []]);
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
    dot.setState('done');
    tick();
    broken = true;
    expect(() => finish(0)).not.toThrow();
    expect([...stamps(root), n(root, 'shot'), n(root, 'ray')]).toEqual(['FIXED ✓ static', 0, 0]);
    vi.advanceTimersByTime(1800);
    expect([...roots, root].flatMap(stamps)).toEqual([]);
  });
});
