// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolveTarget } from '@passback/collectors';
import { CLASS } from './styles';
import { armWidget } from './test-arm';
import { createOverlay, type Overlay } from './overlay';
import { createBubble, type Bubble } from './bubble-view';
import {
  submitDrawing,
  type SubmitCtx,
  type SubmitDetail,
  type SubmitMark,
} from './overlay-submit';

// Settled promises still settle on a microtask: Send's immediate state is visible before flush().
const TARGET: ResolveTarget = { selectors: [], tag: 'div', text: '' };
const now = () => Promise.resolve();
const offline = () => Promise.reject(new Error('collectors offline'));
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
let overlays: Overlay[] = [];

afterEach(() => {
  overlays.forEach((overlay) => overlay.destroy());
  overlays = [];
  document.body.innerHTML = '';
  delete scope.__passback;
});

type Seed = (target: Element) => readonly SubmitMark[] | undefined;
const scope = globalThis as { __passback?: unknown };

function setup(ready?: () => Promise<unknown>, seed?: Seed) {
  let state: SubmitCtx['state'] | undefined;
  scope.__passback = { fx: { addons: [(ctx: SubmitCtx) => (state = ctx.state)] } };
  const host = document.body.appendChild(document.createElement('div'));
  const root = host.attachShadow({ mode: 'open' });
  const onSubmit = vi.fn();
  const selectorOf = vi.fn((el: Element) => el.tagName.toLowerCase());
  const targetOf = vi.fn(() => TARGET);
  const opts = { doc: document, root, host, onSubmit, selectorOf, targetOf, ready };
  const overlay = createOverlay(opts);
  overlays.push(overlay);
  const target = document.body.appendChild(document.createElement('div'));
  target.getBoundingClientRect = () => ({ left: 10, top: 20 }) as DOMRect;
  armWidget(root);
  if (seed !== undefined) state!.batchMarks = seed(target);
  const click = { bubbles: true, cancelable: true, composed: true, clientX: 15, clientY: 27 };
  target.dispatchEvent(new MouseEvent('click', click));
  const textarea = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
  textarea.value = 'hello';
  textarea.dispatchEvent(new Event('input'));
  textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
  const dot = () => root.querySelector(`.${CLASS.dot}`)!.getAttribute('data-state');
  const sent = { comment: 'hello', selector: 'div', offset: { x: 5, y: 7 }, element: target };
  return { host, root, overlay, onSubmit, selectorOf, targetOf, target, dot, sent };
}

describe('overlay submission', () => {
  it('without ready sends synchronously with selector and target', () => {
    const { onSubmit, targetOf, target, sent } = setup();
    expect(onSubmit).toHaveBeenCalledWith(sent);
    expect(targetOf).toHaveBeenCalledWith(target);
  });

  it('with ready shows sending at once and calls selectorOf and onSubmit only after ready resolves', async () => {
    const { host, root, onSubmit, selectorOf, dot, sent } = setup(now);
    expect(host.getAttribute('data-passback-phase')).toBe('sending');
    expect(dot()).toBe('sending');
    expect(root.querySelector(`.${CLASS.bubble}`)!.getAttribute('data-state')).toBe('sending');
    expect(selectorOf).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    await flush();
    expect(onSubmit).toHaveBeenCalledWith(sent);
  });

  it('with ready rejecting shows the error with Retry and calls neither selectorOf nor onSubmit', async () => {
    const { root, onSubmit, selectorOf, targetOf, dot } = setup(offline);
    await flush();
    expect(root.querySelector(`.${CLASS.bubble}`)!.textContent).toContain('collectors offline');
    expect(root.querySelector(`.${CLASS.send}`)!.textContent).toBe('Retry');
    expect(dot()).toBe('failed');
    expect(selectorOf).not.toHaveBeenCalled();
    expect(targetOf).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Retry after a rejected ready waits for ready again and then submits', async () => {
    const ready = vi.fn<() => Promise<unknown>>(offline);
    const { root, onSubmit, dot, sent } = setup(ready);
    await flush();
    ready.mockImplementationOnce(now);
    root.querySelector<HTMLButtonElement>(`.${CLASS.send}`)!.click();
    expect(ready).toHaveBeenCalledTimes(2);
    expect(dot()).toBe('sending');
    expect(onSubmit).not.toHaveBeenCalled();
    await flush();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(sent);
  });

  it('a destroy while ready is pending submits nothing', async () => {
    const { overlay, onSubmit, selectorOf } = setup(now);
    overlay.destroy();
    await flush();
    expect(selectorOf).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('puts the batch marks of the sent pin in the submit detail', () => {
    let marks: readonly SubmitMark[] = [];
    const { onSubmit } = setup(undefined, (target) => {
      const other = document.createElement('p');
      marks = [
        { element: other, offset: { x: 1, y: 1 }, n: 1, current: false },
        { element: target, offset: { x: 5, y: 7 }, n: 2, current: true },
      ];
      return marks;
    });
    expect(onSubmit.mock.calls[0]![0].marks).toBe(marks);
  });

  it('leaves the batch marks out when none of them is the sent element', () => {
    const cases: Seed[] = [
      () => undefined,
      (target) => [{ element: target, offset: { x: 5, y: 7 }, n: 1, current: false }],
      () => [{ element: document.createElement('p'), offset: { x: 1, y: 1 }, n: 1, current: true }],
    ];
    for (const seed of cases) {
      const { onSubmit } = setup(undefined, seed);
      expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty('marks');
    }
  });
});

function drawSetup(ready?: () => Promise<unknown>) {
  let ctx: SubmitCtx | undefined;
  scope.__passback = { fx: { addons: [(c: SubmitCtx) => (ctx = c)] } };
  const host = document.body.appendChild(document.createElement('div'));
  const root = host.attachShadow({ mode: 'open' });
  const onSubmit = vi.fn();
  const drawing = { toggle: vi.fn(), cancel: vi.fn() };
  const opts = { doc: document, root, host, onSubmit, selectorOf: () => 'x', ready, drawing };
  overlays.push(createOverlay(opts));
  armWidget(root);
  const bubble = (): Bubble =>
    createBubble(root, { anchor: { x: 0, y: 0 }, onSend: vi.fn(), onCancel: vi.fn() });
  const detail = (over: Partial<SubmitDetail> = {}): SubmitDetail => ({
    comment: 'look',
    selector: 'body',
    offset: { x: 0, y: 0 },
    element: document.body,
    marks: [],
    ...over,
  });
  const retry = () => root.querySelector<HTMLButtonElement>(`.${CLASS.send}`)!.click();
  return { ctx: ctx!, root, onSubmit, drawing, bubble, detail, retry, host };
}

describe('drawing-only submission', () => {
  it('submits an explicit body detail without a pinned mark', () => {
    const { ctx, onSubmit, drawing, bubble, detail, root } = drawSetup();
    const d = detail();
    expect(submitDrawing(ctx, d, bubble(), 1)).toBe(true);
    expect(onSubmit).toHaveBeenCalledWith(d);
    expect(ctx.state.flow).toBe('sending');
    expect(drawing.toggle).toHaveBeenCalledWith(false);
    expect(ctx.state.pinnedElement).toBeNull();
    expect(ctx.state.marks).toEqual([]);
    expect(root.querySelector(`.${CLASS.dot}`)).toBeNull();
  });

  it('rejects empty and duplicate drawing submissions', () => {
    const { ctx, onSubmit, bubble, detail } = drawSetup();
    expect(submitDrawing(ctx, detail(), bubble(), 0)).toBe(false);
    expect(submitDrawing(ctx, detail({ comment: '  ' }), bubble(), 1)).toBe(false);
    expect(submitDrawing(ctx, detail({ selector: 'p' }), bubble(), 1)).toBe(false);
    expect(submitDrawing(ctx, detail({ marks: undefined }), bubble(), 1)).toBe(false);
    expect(submitDrawing(ctx, detail({ offset: { x: 1, y: 0 } }), bubble(), 1)).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(ctx.state.flow).toBe('armed');
    expect(submitDrawing(ctx, detail(), bubble(), 2)).toBe(true);
    expect(submitDrawing(ctx, detail(), bubble(), 2)).toBe(false);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('retries drawing readiness and drops a destroyed owner', async () => {
    const ready = vi.fn<() => Promise<unknown>>(offline);
    const { ctx, onSubmit, bubble, detail, retry, root } = drawSetup(ready);
    const d = detail();
    expect(submitDrawing(ctx, d, bubble(), 1)).toBe(true);
    await flush();
    expect(root.textContent).toContain('collectors offline');
    expect(onSubmit).not.toHaveBeenCalled();
    let release = () => {};
    ready.mockImplementationOnce(() => new Promise<void>((done) => (release = done)));
    retry();
    retry();
    expect(ready).toHaveBeenCalledTimes(2);
    release();
    await flush();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(d);
    overlays.pop()!.destroy();
    const second = drawSetup(() => new Promise<void>((done) => (release = done)));
    expect(submitDrawing(second.ctx, second.detail(), second.bubble(), 1)).toBe(true);
    overlays[overlays.length - 1]!.destroy();
    release();
    await flush();
    expect(second.onSubmit).not.toHaveBeenCalled();
  });
});
