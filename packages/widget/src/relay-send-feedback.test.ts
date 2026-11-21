// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolveTarget } from '@passback/collectors';
import { createOverlay, type Overlay, type SubmitDetail } from './overlay';
import { COMPLETION_ATTR, Celebration, completionRules } from './completion';
import { RELAY_SENDING } from './relay-send-feedback';
import { stampRules } from './stamp';
import { offerCapture } from './shot-display';
import { mountInk, type Ink } from './shot-ink';
import { grabViewport } from './shot-grab';
import { uploadShot } from './shot-upload';
import { openShot } from './shot';
import { createShotStep, drawingOf } from './shot-step';
import { armWidget } from './test-arm';
import { CLASS } from './styles';
import type { Shape } from './shot-shapes';

vi.mock('./shot-ink', () => ({ mountInk: vi.fn() }));
vi.mock('./shot-grab', () => ({ grabViewport: vi.fn() }));
vi.mock('./shot-upload', () => ({ uploadShot: vi.fn() }));

type Win = Window & typeof globalThis;
const scope = globalThis as { __passback?: unknown };
const arrow: Shape = { tool: 'arrow', from: { x: 1, y: 2 }, to: { x: 30, y: 40 } };
const BALL = { left: 900, top: 700, right: 956, bottom: 756, width: 56, height: 56 };
const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
type Deferred = { promise: Promise<unknown>; resolve(): void; reject(error: Error): void };
function deferred(): Deferred {
  let resolve = (): void => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<unknown>((ok, no) => {
    resolve = () => ok(undefined);
    reject = no;
  });
  return { promise, resolve, reject };
}

let shapes: Shape[] = [];
let change: (count: number) => void = () => undefined;
let overlays: Overlay[] = [];

beforeEach(async () => {
  await document.fonts?.ready;
  shapes = [];
  vi.mocked(mountInk).mockImplementation((_root, _win, onChange) => {
    change = onChange;
    onChange(0);
    return {
      tool: 'arrow',
      shapes: () => shapes,
      setActive: vi.fn(),
      destroy: vi.fn(),
      undo: vi.fn(),
      clear: vi.fn(),
    } as unknown as Ink;
  });
  vi.mocked(grabViewport).mockResolvedValue({
    ok: true,
    blob: new Blob(['x']),
    mime: 'image/webp',
    width: 1,
    height: 1,
    masked: 0,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))),
  );
  vi.mocked(uploadShot).mockResolvedValue({
    ok: true,
    screenshot: {
      id: 'a'.repeat(32),
      mime: 'image/webp',
      width: 1,
      height: 1,
      bytes: 1,
      masked: 0,
    },
  });
  scope.__passback = { shot: openShot };
  document.head.innerHTML =
    '<script data-passback-screenshots="true" data-passback-endpoint="/e" data-passback-shot="/shot.js"></script>';
});

afterEach(() => {
  overlays.forEach((overlay) => overlay.destroy());
  overlays = [];
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete scope.__passback;
});

type Options = { relay?: () => boolean; hiddenBall?: boolean; ready?: () => Promise<unknown> };

function setup({ relay, hiddenBall, ready }: Options = {}) {
  if (hiddenBall) document.head.innerHTML += '<script data-passback-launcher="hidden"></script>';
  const host = document.body.appendChild(document.createElement('div'));
  const root = host.attachShadow({ mode: 'open' });
  const step = createShotStep({
    doc: document,
    win: window as Win,
    root,
    host,
    onLoadFailed: vi.fn(),
  });
  const sent: SubmitDetail[] = [];
  // Like the widget's own send: a capture or transport failure reaches the overlay as a failure.
  const report = (err: unknown): void =>
    overlay.failed(err instanceof Error ? err.message : String(err));
  const overlay: Overlay = createOverlay({
    doc: document,
    root,
    host,
    ready,
    relay,
    selectorOf: () => 'div',
    targetOf: () => ({ selectors: [], tag: 'div', text: '' }) as unknown as ResolveTarget,
    onSubmit: (detail) => {
      sent.push(detail);
      void step.finish(detail.element).then(() => undefined, report);
    },
    ...drawingOf(step),
  });
  overlays.push(overlay);
  const ball = root.querySelector<HTMLButtonElement>(`.${CLASS.launcher}`)!;
  ball.getBoundingClientRect = () => ({ ...BALL, x: BALL.left, y: BALL.top, toJSON: () => ({}) });
  return { host, root, step, overlay, sent, ball };
}
type Rig = ReturnType<typeof setup>;

const dotOf = (root: ShadowRoot): HTMLElement => root.querySelector(`.${CLASS.dot}`)!;
const bubbleOf = (root: ShadowRoot): HTMLElement => root.querySelector(`.${CLASS.bubble}`)!;
const stamps = (root: ShadowRoot): Element[] => [...root.querySelectorAll('.pb-stamp')];
const gone = (el: HTMLElement): boolean => el.hasAttribute('data-pb-relay-gone');

function pinAndSend({ root }: Rig, comment: string): HTMLElement {
  armWidget(root);
  const target = document.body.appendChild(document.createElement('div'));
  target.getBoundingClientRect = () => ({ left: 10, top: 20 }) as DOMRect;
  target.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: 15,
      clientY: 27,
    }),
  );
  const input = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
  input.value = comment;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
  return target;
}

async function drawAndSend(rig: Rig): Promise<void> {
  armWidget(rig.root);
  rig.step.toggle(true);
  await flush();
  shapes = [arrow];
  change(1);
  rig.root.querySelector<HTMLButtonElement>('[data-act="send"]')!.click();
  await flush();
}

describe('relay send feedback', () => {
  it('hides a relay pin synchronously and sends unchanged capture details', async () => {
    const gate = deferred();
    const rig = setup({ relay: () => true, ready: () => gate.promise });
    const { root, sent, ball } = rig;
    const target = pinAndSend(rig, 'hi');
    // Before readiness, capture or ingest: the mark is gone and the ball shows sending.
    expect(gone(dotOf(root))).toBe(true);
    expect(dotOf(root).hidden).toBe(true);
    expect(gone(bubbleOf(root))).toBe(true);
    expect(ball.hasAttribute('hidden')).toBe(false);
    expect(ball.hasAttribute(RELAY_SENDING)).toBe(true);
    expect(ball.getAttribute('aria-busy')).toBe('true');
    expect(root.querySelector('[role="status"]')?.textContent).toBe('Sending');
    expect(sent).toEqual([]);
    gate.resolve();
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ comment: 'hi', selector: 'div' });
    expect(sent[0]!.offset).toEqual({ x: 5, y: 7 });
    expect(sent[0]!.element).toBe(target);
    // The owner survives the hiding: the same detail is what Retry would send.
    expect(root.querySelectorAll(`.${CLASS.dot}`)).toHaveLength(1);
  });

  it('celebrates a relay pin once at the launcher', async () => {
    const rig = setup({ relay: () => true });
    const { root, overlay, ball } = rig;
    pinAndSend(rig, 'hi');
    await flush();
    overlay.acked('m1', false, 'a note', { relay: true });
    overlay.acked('m1', false, 'a note', { relay: true });
    const found = stamps(root);
    expect(found).toHaveLength(1);
    expect(found[0]!.textContent).toBe('SENT!');
    expect(ball.hasAttribute(RELAY_SENDING)).toBe(false);
    expect(ball.hasAttribute('aria-busy')).toBe(false);
    const mark = overlay.openMarks()[0]!;
    expect(mark.id).toBe('m1');
    expect(dotOf(root).getAttribute('data-state')).toBe('sent');
    expect(gone(dotOf(root))).toBe(true);
    expect(bubbleOf(root).hidden).toBe(true);
    expect(bubbleOf(root).textContent).not.toContain('Sent!');
    expect(bubbleOf(root).textContent).not.toContain('a note');
    expect(overlay.phase()).toBe('idle');
    // Local and omitted mode keep the old stamp at the mark.
    for (const relay of [() => false, undefined]) {
      document.body.innerHTML = '';
      const local = setup({ relay });
      pinAndSend(local, 'again');
      await flush();
      expect(dotOf(local.root).hidden).toBe(false);
      expect(gone(dotOf(local.root))).toBe(false);
      expect(local.ball.hasAttribute(RELAY_SENDING)).toBe(false);
      expect(dotOf(local.root).getAttribute('data-state')).toBe('sending');
      local.overlay.acked('m2', false, undefined, { relay: true });
      expect(stamps(local.root)).toHaveLength(1);
      expect(dotOf(local.root).getAttribute('data-state')).toBe('sent');
      expect(gone(dotOf(local.root))).toBe(false);
    }
  });

  it('keeps an acknowledged relay stamp inside every launcher corner', async () => {
    const [VW, VH] = [innerWidth, innerHeight];
    expect([VW, VH, document.documentElement.clientWidth]).toEqual([1024, 768, 0]);
    const font = (el: Element): number => (el.getAttribute(COMPLETION_ATTR) === 'sent' ? 12 : 20);
    const stamp = (el: HTMLElement): boolean => el.isConnected && el.classList.contains('pb-stamp');
    const len = (el: HTMLElement): number => (stamp(el) ? (el.textContent ?? '').length : 0);
    // Measured only once attached, from the final text and font, as a browser does.
    const dims = {
      offsetWidth: (el: HTMLElement) => Math.ceil(len(el) * font(el) * 0.7),
      offsetHeight: (el: HTMLElement) => (stamp(el) ? font(el) : 0),
    };
    for (const [key, get] of Object.entries(dims))
      vi.spyOn(HTMLElement.prototype, key as 'offsetWidth', 'get').mockImplementation(function (
        this: HTMLElement,
      ) {
        return get(this);
      });
    const css = stampRules() + completionRules();
    const poses = [...css.matchAll(/transform: rotate\((-?[\d.]+)deg\)(?: scale\(([\d.]+)\))?/g)];
    const make = (...a: ConstructorParameters<typeof Celebration>) => new Celebration(...a);
    const corners = [30, VW - 30].flatMap((cx) => [30, VH - 30].map((cy) => [cx, cy] as const));
    for (const effects of [false, true]) {
      for (const [cx, cy] of corners) {
        scope.__passback = { shot: openShot, ...(effects ? { fx: { celebrate: make } } : {}) };
        const rig = setup({ relay: () => true });
        rig.ball.getBoundingClientRect = () => new DOMRect(cx - 18, cy - 18, 36, 36);
        pinAndSend(rig, 'hi');
        await flush();
        [1, 2].forEach(() => rig.overlay.acked('m1', false, 'a note', { relay: true }));
        const [el, ...more] = stamps(rig.root) as HTMLElement[];
        expect([more.length, el!.textContent]).toEqual([0, 'SENT!']);
        expect(el!.getAttribute('aria-hidden')).toBe('true');
        expect(el!.getAttribute(COMPLETION_ATTR)).toBe(effects ? 'sent' : null);
        const [w, h] = [el!.offsetWidth, el!.offsetHeight];
        const [left, top] = [Number.parseFloat(el!.style.left), Number.parseFloat(el!.style.top)];
        // Box corners off screen in any keyframe or static pose, about the bottom-left origin.
        const out = poses.flatMap(([, deg, sc]) => {
          const [a, s] = [(Number(deg) * Math.PI) / 180, Number(sc ?? 1)];
          const [c, n] = [s * Math.cos(a), s * Math.sin(a)];
          const at = (x: number, y: number) => [left + x * c - y * n, top + h + x * n + y * c];
          const pts = [at(0, 0), at(w, 0), at(0, -h), at(w, -h)];
          return pts.filter(([px, py]) => px! < -1 || px! > VW + 1 || py! < -1 || py! > VH + 1);
        });
        expect([w * h > 0, out]).toEqual([true, []]);
        // Inward: right from a left corner, left from a right one, down from the top, up from below.
        expect(cx < VW / 2 ? left > cx - 1 : left + w <= cx + 1).toBe(true);
        expect(cy < VH / 2 ? top > cy - 1 : top + h / 2 < cy).toBe(true);
      }
    }
  });

  it('keeps relay errors and Retry beside the launcher', async () => {
    const outcomes = [deferred(), deferred(), deferred()];
    const ready = vi.fn(() => outcomes.shift()!.promise);
    // A rejection first, then a thrown failure, then success.
    const first = outcomes[0]!;
    const second = outcomes[1]!;
    const third = outcomes[2]!;
    const rig = setup({ relay: () => true, hiddenBall: true, ready });
    const { root, ball, overlay, sent } = rig;
    expect(ball.hasAttribute('hidden')).toBe(true);
    pinAndSend(rig, 'keep me');
    expect(ball.hasAttribute('hidden')).toBe(false);
    first.reject(new Error('readiness failed'));
    await flush();
    expect(ball.hasAttribute(RELAY_SENDING)).toBe(false);
    expect(ball.getAttribute('aria-busy')).toBeNull();
    expect(bubbleOf(root).hidden).toBe(false);
    expect(gone(bubbleOf(root))).toBe(false);
    expect(bubbleOf(root).textContent).toContain('readiness failed');
    expect(bubbleOf(root).textContent).toContain('kept');
    expect(gone(dotOf(root))).toBe(true);
    // Placed beside the ball (flipped left of its left edge), not at the pin at (15, 27).
    expect(bubbleOf(root).style.left).toContain(`${BALL.left}px`);
    expect(bubbleOf(root).style.top).toContain(`${BALL.top}px`);
    const retry = (): HTMLButtonElement => root.querySelector<HTMLButtonElement>(`.${CLASS.send}`)!;
    expect(retry().textContent).toBe('Retry');
    // Docked at the ball: scrolling must not move Retry back to the pin.
    expect(bubbleOf(root).hasAttribute('data-docked')).toBe(true);
    retry().click();
    expect(bubbleOf(root).hasAttribute('data-docked')).toBe(false);
    // Retry hides the error and resumes sending at the ball.
    expect(ball.hasAttribute(RELAY_SENDING)).toBe(true);
    expect(bubbleOf(root).hidden).toBe(true);
    second.resolve();
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.comment).toBe('keep me');
    // The transport rejects it: the same pending detail comes back through the same Retry.
    overlay.failed('ingest said no');
    expect(bubbleOf(root).textContent).toContain('ingest said no');
    expect(ball.hasAttribute(RELAY_SENDING)).toBe(false);
    expect(gone(dotOf(root))).toBe(true);
    const pending = sent[0];
    retry().click();
    expect(ball.hasAttribute(RELAY_SENDING)).toBe(true);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toBe(pending);
    third.resolve();
    overlay.acked('m3', false, undefined, { relay: true });
    expect(stamps(root)).toHaveLength(1);
    // The sent mark stays hidden, and the hidden-configured ball keeps its place.
    expect(gone(dotOf(root))).toBe(true);
  });

  it('gives drawing sends one launcher feedback lifecycle', async () => {
    const gate = deferred();
    const rig = setup({ relay: () => true, hiddenBall: true, ready: () => gate.promise });
    const { root, ball, overlay, sent } = rig;
    await drawAndSend(rig);
    expect(ball.hasAttribute(RELAY_SENDING)).toBe(true);
    expect(gone(bubbleOf(root))).toBe(true);
    expect(sent).toEqual([]);
    gate.resolve();
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ selector: 'body', marks: [] });
    overlay.failed('upload failed');
    expect(bubbleOf(root).textContent).toContain('upload failed');
    expect(gone(bubbleOf(root))).toBe(false);
    // A configured-hidden ball stays up while the error waits for Retry, even with no marks.
    expect(ball.hasAttribute('hidden')).toBe(false);
    expect(ball.hasAttribute(RELAY_SENDING)).toBe(false);
    root.querySelector<HTMLButtonElement>(`.${CLASS.send}`)!.click();
    expect(ball.hasAttribute(RELAY_SENDING)).toBe(true);
    expect(sent).toHaveLength(2);
    overlay.acked('d1', false, undefined, { relay: true });
    // One stamp, from the helper alone: the drawing's own acknowledgement override does not also run.
    expect(stamps(root)).toHaveLength(1);
    expect(stamps(root)[0]!.textContent).toBe('SENT!');
    expect(ball.hasAttribute(RELAY_SENDING)).toBe(false);
    expect(bubbleOf(root).hidden).toBe(true);
    expect(root.querySelector('[data-act="send"]')).toBeNull();
    expect(overlay.phase()).toBe('idle');
    await flush();
    expect(stamps(root)).toHaveLength(1);
  });

  it('keeps relay errors and Retry beside the launcher when the transport throws', async () => {
    const rig = setup({ relay: () => true, hiddenBall: true });
    const { root, ball, sent } = rig;
    vi.mocked(uploadShot).mockRejectedValueOnce(new Error('upload exploded'));
    pinAndSend(rig, 'keep me');
    await flush();
    expect(sent).toHaveLength(1);
    expect(bubbleOf(root).textContent).toContain('Screenshot required');
    expect(bubbleOf(root).hasAttribute('data-pb-relay-error')).toBe(true);
    expect(gone(bubbleOf(root))).toBe(false);
    expect(gone(dotOf(root))).toBe(true);
    expect(ball.hasAttribute(RELAY_SENDING)).toBe(false);
    // A configured-hidden ball stays reachable while the error waits for Retry.
    expect(ball.hasAttribute('hidden')).toBe(false);
    root.querySelector<HTMLButtonElement>(`.${CLASS.send}`)!.click();
    await flush();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toBe(sent[0]);
  });

  it('leaves the capture fallback reachable while the pin is hidden', async () => {
    const gate = deferred();
    const rig = setup({ relay: () => true, ready: () => gate.promise });
    const { root, host } = rig;
    const win = window as Win;
    Object.defineProperty(win.navigator, 'mediaDevices', {
      configurable: true,
      value: { getDisplayMedia: vi.fn(() => new Promise(() => undefined)) },
    });
    pinAndSend(rig, 'hi');
    expect(gone(bubbleOf(root))).toBe(true);
    const offered = offerCapture(win, host, { makeCanvas: () => document.createElement('canvas') });
    offered.catch(() => undefined);
    const button = root.querySelector<HTMLButtonElement>('[data-role="capture-screen"]')!;
    expect(button.closest(`.${CLASS.bubble}`)).toBe(bubbleOf(root));
    expect(bubbleOf(root).hidden).toBe(false);
    // The hiding rule steps aside for a bubble that holds the fallback button.
    const css = [...root.querySelectorAll('style')].map((style) => style.textContent).join('\n');
    expect(css).toContain(':not(:has([data-role="capture-screen"]))');
    Reflect.deleteProperty(win.navigator, 'mediaDevices');
  });

  it('places the docked error by moveTo alone and keeps Capture screen visible', async () => {
    const outcome = deferred();
    const rig = setup({ relay: () => true, ready: () => outcome.promise });
    const { root } = rig;
    pinAndSend(rig, 'keep me');
    outcome.reject(new Error('readiness failed'));
    await flush();
    const bubble = bubbleOf(root);
    expect(bubble.hasAttribute('data-docked')).toBe(true);
    // The docked rule would pin the bubble across the bottom; the error rule gives it back its undocked box,
    // with a more specific selector, so only the left and top that moveTo writes place it.
    const css = [...root.querySelectorAll('style')].map((s) => s.textContent).join('\n');
    const reset = new RegExp(
      `\\.${CLASS.bubble}\\[data-pb-relay-error\\]\\[data-docked\\] \\{([^}]*)\\}`,
    ).exec(css)?.[1];
    expect(reset).toBeDefined();
    for (const decl of [
      'position: absolute',
      'right: auto',
      'bottom: auto',
      'width: var(--pb-size-box)',
      'max-width: none',
    ]) {
      expect(reset).toContain(decl);
    }
    expect(reset).not.toMatch(/(^|[ ;])(left|top):/);
    expect(bubble.style.left).toContain(`${BALL.left}px`);
    expect(bubble.style.top).toContain(`${BALL.top}px`);
    // Capture screen: corner-pins writes visibility hidden inline when the pin's target scrolls away.
    const win = window as Win;
    const gate = deferred();
    const fallback = setup({ relay: () => true, ready: () => gate.promise });
    Object.defineProperty(win.navigator, 'mediaDevices', {
      configurable: true,
      value: { getDisplayMedia: vi.fn(() => new Promise(() => undefined)) },
    });
    pinAndSend(fallback, 'hi');
    const offered = offerCapture(win, fallback.host, {
      makeCanvas: () => document.createElement('canvas'),
    });
    offered.catch(() => undefined);
    const sending = bubbleOf(fallback.root);
    expect(gone(sending)).toBe(true);
    expect(sending.querySelector('[data-role="capture-screen"]')).not.toBeNull();
    sending.style.visibility = 'hidden';
    const sheet = [...fallback.root.querySelectorAll('style')].map((s) => s.textContent).join('\n');
    expect(sheet).toContain(
      `.${CLASS.bubble}[data-pb-relay-gone]:has([data-role="capture-screen"]) { visibility: visible !important; }`,
    );
    Reflect.deleteProperty(win.navigator, 'mediaDevices');
  });

  it('respects reduced motion and ignores disposed outcomes', async () => {
    const stampRig = setup({ relay: () => true, ready: () => Promise.resolve() });
    pinAndSend(stampRig, 'stamped');
    await flush();
    stampRig.overlay.acked('s1', false, undefined, { relay: true });
    expect(stamps(stampRig.root)).toHaveLength(1);
    // A second send keeps the first send's stamp; dispose removes both.
    pinAndSend(stampRig, 'stamped again');
    await flush();
    stampRig.overlay.acked('s2', false, undefined, { relay: true });
    expect(stamps(stampRig.root)).toHaveLength(2);
    stampRig.overlay.destroy();
    expect(stamps(stampRig.root)).toHaveLength(0);
    const gate = deferred();
    const rig = setup({ relay: () => true, ready: () => gate.promise });
    const { root, overlay, ball } = rig;
    pinAndSend(rig, 'late');
    const css = [...root.querySelectorAll('style')].map((style) => style.textContent).join('\n');
    const reduced = css.slice(
      css.indexOf('prefers-reduced-motion: reduce', css.indexOf('pb-relay-spin')),
    );
    expect(reduced).toContain(`[${RELAY_SENDING}]::after { animation: none; border-color`);
    expect(ball.hasAttribute(RELAY_SENDING)).toBe(true);
    overlay.destroy();
    expect(root.querySelector('[data-pb-relay-styles]')).toBeNull();
    expect(root.querySelector('.pb-relay-status')).toBeNull();
    expect(ball.hasAttribute(RELAY_SENDING)).toBe(false);
    gate.resolve();
    overlay.acked('late-1', false, undefined, { relay: true });
    overlay.failed('too late');
    await flush();
    expect(stamps(root)).toHaveLength(0);
    expect(rig.sent).toEqual([]);
  });
});
