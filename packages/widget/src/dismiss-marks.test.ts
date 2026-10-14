// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXED_CLEAR_MS, dismissMarks } from './dismiss-marks';
import type { Overlay } from './overlay';
import { createOverlay } from './overlay';
import { palette } from './palette';
import { CLASS } from './styles';

const scope = globalThis as { __passback?: unknown };
let overlays: Overlay[] = [];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  overlays.forEach((overlay) => overlay.destroy());
  overlays = [];
  delete scope.__passback;
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup() {
  scope.__passback = { fx: { addons: [palette, dismissMarks] } };
  const host = document.body.appendChild(document.createElement('div'));
  const root = host.attachShadow({ mode: 'open' });
  const overlay = createOverlay({
    doc: document,
    root,
    host,
    selectorOf: (el) => el.tagName.toLowerCase(),
    onSubmit: vi.fn(),
  });
  overlays.push(overlay);
  return { host, root, overlay };
}

function compose(root: ShadowRoot, text: string): HTMLTextAreaElement {
  const target = document.body.appendChild(document.createElement('div'));
  target.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }),
  );
  const input = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
  input.value = text;
  input.dispatchEvent(new Event('input'));
  return input;
}

const enter = (input: HTMLTextAreaElement) =>
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );

function send(r: ReturnType<typeof setup>, id: string, relay: boolean) {
  r.overlay.arm();
  enter(compose(r.root, id));
  r.overlay.acked(id, false, undefined, { relay });
}

const dots = (root: ShadowRoot) => root.querySelectorAll(`.${CLASS.dot}`).length;
const dismiss = (root: ShadowRoot) => root.querySelectorAll<HTMLElement>("button[part='dismiss']");
const clearSent = (root: ShadowRoot) =>
  root.querySelector<HTMLButtonElement>('button[data-act="clear-sent"]')!;

describe('dismissMarks', () => {
  it('removes a Fixed mark 2220 ms after done and keeps a Failed one', () => {
    const r = setup();
    send(r, 'm1', true);
    r.overlay.status({ markId: 'm1', state: 'done' });
    send(r, 'm2', true);
    r.overlay.status({ markId: 'm2', state: 'failed' });
    expect(FIXED_CLEAR_MS).toBe(2220);
    for (let t = 0; t < FIXED_CLEAR_MS - 1; t += 1) {
      vi.advanceTimersByTime(1);
      expect(r.root.querySelector('[data-pb-leaving]')).toBeNull();
    }
    expect(dots(r.root)).toBe(2);
    vi.advanceTimersByTime(1);
    expect(r.root.querySelector('[data-pb-leaving]')).toBeNull();
    expect(dots(r.root)).toBe(1);
    vi.advanceTimersByTime(FIXED_CLEAR_MS * 2);
    expect(dots(r.root)).toBe(1);
    r.overlay.status({ markId: 'm1', state: 'done' });
    expect(dots(r.root)).toBe(1);
  });

  it('removes the pin and the stamp together within 500 ms', () => {
    const r = setup();
    send(r, 'm1', true);
    vi.advanceTimersByTime(1800);
    expect(r.root.querySelector('.pb-stamp')).toBeNull();
    r.overlay.status({ markId: 'm1', state: 'done' });
    expect(r.root.querySelector('.pb-stamp')).not.toBeNull();
    expect(dots(r.root)).toBe(1);
    for (let t = 1; t < FIXED_CLEAR_MS; t += 1) {
      vi.advanceTimersByTime(1);
      if (t === 1800) expect(r.root.querySelector('.pb-stamp')).toBeNull();
      expect(dots(r.root)).toBe(1);
    }
    vi.advanceTimersByTime(1);
    expect(dots(r.root)).toBe(0);
    expect(r.root.querySelector('.pb-stamp')).toBeNull();
    expect(FIXED_CLEAR_MS - 1800).toBeLessThanOrEqual(500);
  });

  it('removes the celebration in the same tick the pin leaves', () => {
    let stampGone: number | undefined;
    let dotGone: number | undefined;
    const r = setup();
    const fx = (scope.__passback as { fx: { celebrate?: unknown } }).fx;
    fx.celebrate = (_root: ShadowRoot, _dot: HTMLElement, state: string) => ({
      move: vi.fn(),
      remove: () => {
        if (state === 'done') stampGone = Date.now();
      },
    });
    send(r, 'm1', true);
    r.overlay.status({ markId: 'm1', state: 'done' });
    const dot = r.root.querySelector<HTMLElement>(`.${CLASS.dot}`)!;
    vi.advanceTimersByTime(FIXED_CLEAR_MS - 1);
    expect(stampGone).toBeUndefined();
    expect(dot.isConnected).toBe(true);
    const tick = Date.now() + 1;
    vi.advanceTimersByTime(1);
    if (!dot.isConnected) dotGone = Date.now();
    expect(stampGone).toBe(tick);
    expect(dotGone).toBe(tick);
  });

  it('keeps a mark that is reopened before the timer ends', () => {
    const r = setup();
    send(r, 'm1', true);
    r.overlay.status({ markId: 'm1', state: 'done' });
    vi.advanceTimersByTime(FIXED_CLEAR_MS - 1);
    r.overlay.status({ markId: 'm1', state: 'running' });
    vi.advanceTimersByTime(FIXED_CLEAR_MS * 2);
    expect(dots(r.root)).toBe(1);
  });

  it('shows Dismiss only on a Sent mark and removes it on click', () => {
    const r = setup();
    send(r, 'm1', true);
    expect(dismiss(r.root)).toHaveLength(1);
    expect(dismiss(r.root)[0]!.getAttribute('aria-label')).toBe('Dismiss');
    send(r, 'm2', false);
    r.overlay.status({ markId: 'm2', state: 'running' });
    expect(dismiss(r.root)).toHaveLength(1);
    dismiss(r.root)[0]!.click();
    expect(dots(r.root)).toBe(1);
    expect(dismiss(r.root)).toHaveLength(0);
  });

  it('Clear sent removes Sent marks and keeps kept comments', () => {
    const r = setup();
    expect(clearSent(r.root).hidden).toBe(true);
    send(r, 'm1', true);
    send(r, 'm2', true);
    r.overlay.arm();
    compose(r.root, 'draft').dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    const before = dots(r.root);
    expect(clearSent(r.root).hidden).toBe(false);
    expect(clearSent(r.root).getAttribute('aria-label')).toBe('Clear sent');
    clearSent(r.root).click();
    expect(dots(r.root)).toBe(before - 2);
    expect(clearSent(r.root).hidden).toBe(true);
  });

  it('a hidden then shown widget does not bring a removed mark back', () => {
    const r = setup();
    send(r, 'm1', true);
    dismiss(r.root)[0]!.click();
    r.host.toggleAttribute('data-pb-hide');
    r.host.toggleAttribute('data-pb-hide');
    r.overlay.status({ markId: 'm1', state: 'done' });
    expect(dots(r.root)).toBe(0);
  });
});
