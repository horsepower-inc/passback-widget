// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flyToLauncher } from './fly';
import { CLASS } from './styles';
import type { Overlay } from './overlay';
import { createOverlay } from './overlay';
import type { TrackedMark } from './overlay-reattach';
import { applyStatus, KEPT_FULL_NOTE } from './overlay-marks';

let overlays: Overlay[] = [];

afterEach(() => {
  overlays.forEach((overlay) => overlay.destroy());
  overlays = [];
  document.body.innerHTML = '';
});

function setup() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  const onSubmit = vi.fn();
  const overlay = createOverlay({
    doc: document,
    root,
    host,
    selectorOf: (el) => el.tagName.toLowerCase(),
    onSubmit,
  });
  overlays.push(overlay);
  return { root, overlay, onSubmit };
}

function pinTarget(): void {
  const target = document.createElement('div');
  document.body.appendChild(target);
  target.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: 5,
      clientY: 5,
    }),
  );
}

function type(root: ShadowRoot, text: string): void {
  const textarea = root.querySelector<HTMLTextAreaElement>('textarea')!;
  textarea.value = text;
  textarea.dispatchEvent(new Event('input'));
}

function keepButton(root: ShadowRoot): HTMLButtonElement | null {
  return root.querySelector<HTMLButtonElement>('button[data-role="add-more"]');
}

function keepOne(root: ShadowRoot, overlay: Overlay, text: string): void {
  if (overlay.phase() === 'idle') overlay.arm();
  pinTarget();
  type(root, text);
  keepButton(root)!.click();
}

describe('keeping comments', () => {
  it('keeps the comment: the pin shows 1, the box leaves the page and the overlay is choosing again', () => {
    const { root, overlay } = setup();
    keepOne(root, overlay, 'first');
    const dots = root.querySelectorAll<HTMLElement>(`.${CLASS.dot}`);
    expect(dots).toHaveLength(1);
    expect(dots[0]!.textContent).toBe('1');
    expect(dots[0]!.getAttribute('data-n')).toBe('1');
    expect(root.querySelector(`.${CLASS.bubble}`)).toBeNull();
    expect(overlay.phase()).toBe('armed');
  });

  it('numbers the next kept pin 2 and keeps both pins on the page', () => {
    const { root, overlay } = setup();
    keepOne(root, overlay, 'first');
    keepOne(root, overlay, 'second');
    const texts = [...root.querySelectorAll(`.${CLASS.dot}`)].map((d) => d.textContent);
    expect(texts).toEqual(['1', '2']);
  });

  it('numbers a new open pin after the kept ones', () => {
    const { root, overlay } = setup();
    keepOne(root, overlay, 'first');
    keepOne(root, overlay, 'second');
    pinTarget();
    const texts = () => [...root.querySelectorAll(`.${CLASS.dot}`)].map((d) => d.textContent);
    expect(texts()).toEqual(['1', '2', '3']);
    type(root, 'third');
    keepButton(root)!.click();
    const last = [...root.querySelectorAll<HTMLElement>(`.${CLASS.dot}`)].pop()!;
    expect([last.textContent, last.getAttribute('data-n')]).toEqual(['3', '3']);
  });

  it('numbers the first open pin 1 when nothing is kept', () => {
    const { root, overlay } = setup();
    overlay.arm();
    pinTarget();
    expect(root.querySelector(`.${CLASS.dot}`)!.textContent).toBe('1');
  });

  it('submits nothing when a comment is kept', () => {
    const { root, overlay, onSubmit } = setup();
    keepOne(root, overlay, 'first');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('sends a single comment with Send when nothing is kept', () => {
    const { root, overlay, onSubmit } = setup();
    overlay.arm();
    pinTarget();
    type(root, 'alone');
    const send = root.querySelector<HTMLElement>('.pb-bubble .pb-send');
    expect(send!.textContent).toBe('Send');
    send!.click();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0].comment).toBe('alone');
  });

  it('the bubble Send all keeps the open comment as the last point and asks the collector chunk to send all', () => {
    const { root, overlay, onSubmit } = setup();
    const host = root.host;
    const heard = vi.fn();
    host.addEventListener('passback:send-all', heard);
    keepOne(root, overlay, 'first');
    pinTarget();
    type(root, 'last');
    const send = root.querySelector<HTMLElement>('.pb-bubble .pb-send')!;
    expect(send.textContent).toBe('Send all');
    send.click();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(heard).toHaveBeenCalledTimes(1);
    const dots = [...root.querySelectorAll(`.${CLASS.dot}`)].map((d) => d.textContent);
    expect(dots).toEqual(['1', '2']);
    expect(root.querySelector(`.${CLASS.bubble}`)).toBeNull();
  });

  it('dispatches Send all with the default comment for a blank open mark', () => {
    const { root, overlay } = setup();
    const heard = vi.fn();
    root.host.addEventListener('passback:send-all', heard);
    keepOne(root, overlay, 'first');
    pinTarget();
    type(root, '   ');
    root.querySelector<HTMLElement>('.pb-bubble .pb-send')!.click();
    expect(heard).toHaveBeenCalledTimes(1);
    const dots = [...root.querySelectorAll(`.${CLASS.dot}`)].map((d) => d.textContent);
    expect(dots).toEqual(['1', '2']);
  });

  it('keeps the kept pins when Escape leaves choosing', () => {
    const { root, overlay } = setup();
    keepOne(root, overlay, 'first');
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(overlay.phase()).toBe('idle');
    expect(root.querySelectorAll(`.${CLASS.dot}`)).toHaveLength(1);
  });

  it('offers no plus button and explains the limit once 20 comments are kept', () => {
    const { root, overlay } = setup();
    for (let i = 0; i < 20; i += 1) keepOne(root, overlay, `c${i}`);
    pinTarget();
    expect(keepButton(root)).toBeNull();
    expect(root.querySelector(`.${CLASS.bubble}`)!.textContent).toContain(KEPT_FULL_NOTE);
  });

  it('relays a status to the pin and the box of its mark', () => {
    const setState = vi.fn();
    const showStatus = vi.fn();
    const mark = {
      id: 'm1',
      dot: { setState },
      bubble: { showStatus },
      lastState: 'queued',
    } as unknown as TrackedMark;
    const event = { markId: 'm1', state: 'done' } as Parameters<typeof applyStatus>[1];
    expect(applyStatus([mark], event)).toBe(true);
    expect(setState).toHaveBeenCalledWith('done');
    expect(showStatus).toHaveBeenCalledWith(event);
    expect(mark.lastState).toBe('done');
    expect(applyStatus([mark], { ...event, markId: 'nope' })).toBe(false);
    expect(setState).toHaveBeenCalledTimes(1);
  });
});

describe('R3 flight to the ball', () => {
  const rect = { left: 0, top: 0, right: 30, bottom: 30, width: 30, height: 30, x: 0, y: 0 };
  const badge = (root: ShadowRoot) => root.querySelector(`.${CLASS.count}`)!.textContent;

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as { __passback?: unknown }).__passback;
  });

  function prepare(reduce: boolean, fx = true) {
    (globalThis as { __passback?: unknown }).__passback = fx ? { fx: { fly: flyToLauncher } } : {};
    vi.spyOn(Element.prototype, 'animate').mockReturnValue({} as Animation);
    vi.stubGlobal('matchMedia', () => ({ matches: reduce }));
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: reduce }),
    });
    const r = setup();
    const ball = r.root.querySelector<HTMLElement>(`.${CLASS.launcher}`)!;
    ball.removeAttribute('hidden');
    ball.getBoundingClientRect = () => rect as DOMRect;
    return r;
  }

  it('R3 Add more keeps the comment as a numbered point and flies it to the ball', () => {
    const { root, overlay } = prepare(false);
    keepOne(root, overlay, '  fly me  ');
    const chips = root.querySelectorAll('.pb-fly');
    expect(chips).toHaveLength(1);
    expect(chips[0]!.textContent).toBe('fly me');
    expect(root.querySelector(`.${CLASS.dot}`)!.textContent).toBe('1');
  });

  it('headroom keeps the comment without a flight when the effects chunk is missing', () => {
    const { root, overlay } = prepare(false, false);
    keepOne(root, overlay, 'no chunk');
    expect(root.querySelector('.pb-fly')).toBeNull();
    expect(root.querySelector(`.${CLASS.dot}`)!.textContent).toBe('1');
    expect(badge(root)).toBe('1');
  });

  it('R3 Add more updates the ball count and skips the flight under reduced motion', () => {
    const { root, overlay } = prepare(true);
    keepOne(root, overlay, 'one');
    keepOne(root, overlay, 'two');
    expect(root.querySelector('.pb-fly')).toBeNull();
    expect(badge(root)).toBe('2');
  });
});
