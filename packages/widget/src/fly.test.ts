// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUMP_MS, FLY_CLASS, FLY_FALLBACK_MS, flyMs, flyRules, flyToLauncher } from './fly';
import { SCHEMES, TOKENS } from './tokens';

type Call = { el: Element; keyframes: Keyframe[]; options: KeyframeAnimationOptions };
type Fake = { onfinish: (() => void) | null; oncancel: (() => void) | null };

let calls: Call[] = [];
let anims: Fake[] = [];
let host: HTMLElement;
let root: ShadowRoot;
let launcher: HTMLElement;

function installAnimate(): void {
  (Element.prototype as unknown as { animate: unknown }).animate = function (
    this: Element,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions,
  ) {
    calls.push({ el: this, keyframes, options });
    const a: Fake = { onfinish: null, oncancel: null };
    anims.push(a);
    return a;
  };
}

function fakeWin(reduce = false, token = '420ms'): Window {
  return {
    matchMedia: () => ({ matches: reduce }),
    getComputedStyle: () => ({ getPropertyValue: () => token }),
  } as unknown as Window;
}

function box(el: HTMLElement, r: { left: number; top: number; w: number; h: number }): void {
  const { left, top, w, h } = r;
  el.getBoundingClientRect = () =>
    ({ left, top, width: w, height: h, right: left + w, bottom: top + h, x: left, y: top }) as DOMRect;
}

function fly(win: Window, text = 'hello'): boolean {
  return flyToLauncher({ root, from: { x: 100, y: 100 }, to: launcher, text, win });
}

beforeEach(() => {
  calls = [];
  anims = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = host.attachShadow({ mode: 'open' });
  launcher = document.createElement('button');
  root.appendChild(launcher);
  box(launcher, { left: 1200, top: 600, w: 36, h: 36 });
  installAnimate();
});

afterEach(() => {
  delete (Element.prototype as unknown as { animate?: unknown }).animate;
  host.remove();
});

describe('fly', () => {
  it('reads the duration from the token text and falls back to 420', () => {
    expect(flyMs('420ms')).toBe(420);
    expect(flyMs(' 300ms ')).toBe(300);
    expect(flyMs('0.5s')).toBe(500);
    for (const bad of ['', 'fast', '0ms', '-5ms', '0s']) expect(flyMs(bad)).toBe(FLY_FALLBACK_MS);
  });

  it('adds no chip under prefers-reduced-motion', () => {
    expect(fly(fakeWin(true))).toBe(false);
    expect(root.querySelector('.' + FLY_CLASS)).toBeNull();
    expect(root.querySelector('style')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('adds no chip when the browser has no Web Animations API', () => {
    delete (Element.prototype as unknown as { animate?: unknown }).animate;
    expect(fly(fakeWin())).toBe(false);
    expect(root.querySelector('.' + FLY_CLASS)).toBeNull();
  });

  it('adds no chip when the launcher is hidden', () => {
    launcher.setAttribute('hidden', '');
    expect(fly(fakeWin())).toBe(false);
    launcher.removeAttribute('hidden');
    box(launcher, { left: 0, top: 0, w: 0, h: 0 });
    expect(fly(fakeWin())).toBe(false);
    expect(root.querySelector('.' + FLY_CLASS)).toBeNull();
  });

  it('flies a chip with the comment from the pin to the centre of the launcher', () => {
    expect(fly(fakeWin(false, '300ms'), 'a comment')).toBe(true);
    const chip = root.querySelector<HTMLElement>('.' + FLY_CLASS) as HTMLElement;
    expect(chip.textContent).toBe('a comment');
    expect(chip.getAttribute('aria-hidden')).toBe('true');
    expect([chip.style.left, chip.style.top]).toEqual(['100px', '118px']);
    const call = calls[0] as Call;
    expect(calls).toHaveLength(1);
    expect(call.el).toBe(chip);
    expect(call.keyframes[1]?.transform).toBe('translate(1118px,500px) scale(.1)');
    expect(call.options).toMatchObject({
      duration: 300,
      fill: 'forwards',
      easing: 'cubic-bezier(.5,0,.8,.4)',
    });
  });

  it('renders the comment as literal text', () => {
    fly(fakeWin(), '<img src=x onerror=alert(1)>');
    const chip = root.querySelector('.' + FLY_CLASS);
    expect(chip?.querySelector('img')).toBeNull();
    expect(chip?.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('removes the chip and bumps the launcher when the flight ends', () => {
    fly(fakeWin());
    anims[0]?.onfinish?.();
    expect(root.querySelector('.' + FLY_CLASS)).toBeNull();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.el).toBe(launcher);
    expect(calls[1]?.options.duration).toBe(BUMP_MS);
  });

  it('removes the chip without a bump when the flight is cancelled', () => {
    fly(fakeWin());
    anims[0]?.oncancel?.();
    expect(root.querySelector('.' + FLY_CLASS)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('installs its rule once per root and uses only custom properties the style kit declares', () => {
    fly(fakeWin());
    fly(fakeWin());
    expect(root.querySelectorAll('style[data-pb-fly-styles]')).toHaveLength(1);
    expect(root.querySelector('style[data-pb-fly-styles]')?.textContent).toBe(flyRules());
    const known = new Set([...Object.keys(TOKENS), ...Object.keys(SCHEMES.dark)]);
    const used = [...flyRules().matchAll(/var\((--pb-[a-z-]+)\)/g)].map((m) => m[1] as string);
    expect(used.length).toBeGreaterThan(0);
    for (const name of used) expect(known.has(name)).toBe(true);
  });
});
