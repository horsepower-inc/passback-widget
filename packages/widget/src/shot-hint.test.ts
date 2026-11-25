// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOverlay, type Overlay } from './overlay';
import { mountInk, type Ink } from './shot-ink';
import { grabViewport } from './shot-grab';
import { uploadShot } from './shot-upload';
import { openShot } from './shot';
import { drawingComment } from './shot-send';
import { createShotStep, drawingOf } from './shot-step';
import { armWidget } from './test-arm';
import { CLASS, styleSheet } from './styles';
import type { Shape } from './shot-shapes';
import type { SubmitDetail } from './overlay-submit';

vi.mock('./shot-ink', () => ({ mountInk: vi.fn() }));
vi.mock('./shot-grab', () => ({ grabViewport: vi.fn() }));
vi.mock('./shot-upload', () => ({ uploadShot: vi.fn() }));

const arrow: Shape = { tool: 'arrow', from: { x: 1, y: 2 }, to: { x: 30, y: 40 } };
const box: Shape = { tool: 'box', from: { x: 5, y: 6 }, to: { x: 50, y: 60 } };
const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
type Win = Window & typeof globalThis;
const scope = globalThis as { __passback?: unknown };
let overlays: Overlay[] = [];
let shapes: Shape[] = [];
let change: (count: number) => void = () => undefined;

beforeEach(() => {
  vi.resetAllMocks();
  shapes = [];
  const ink: Ink = {
    tool: 'arrow',
    shapes: () => shapes,
    setActive: vi.fn(),
    destroy: vi.fn(),
    undo: () => {
      shapes = shapes.slice(0, -1);
      change(shapes.length);
    },
    clear: () => {
      shapes = [];
      change(0);
    },
  };
  vi.mocked(mountInk).mockImplementation((_root, _win, onChange) => {
    change = onChange;
    onChange(0);
    return ink;
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
  delete scope.__passback;
});

function setup(ready?: () => Promise<unknown>) {
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
  const finished = vi.fn();
  const overlay = createOverlay({
    doc: document,
    root,
    host,
    ready,
    selectorOf: () => 'div',
    onSubmit: (detail) => {
      sent.push(detail);
      host.dispatchEvent(new CustomEvent('passback:submit', { detail }));
      void step.finish(detail.element).then(finished, () => undefined);
    },
    ...drawingOf(step),
  });
  overlays.push(overlay);
  armWidget(root);
  const send = () => root.querySelector<HTMLButtonElement>('[data-act="send"]');
  const draw = (...added: Shape[]) => {
    shapes = [...shapes, ...added];
    change(shapes.length);
  };
  const open = async () => {
    step.toggle(true);
    await flush();
  };
  return { host, root, step, overlay, sent, finished, send, draw, open };
}

// The hint's layout and pointer contract, read from the widget's own scoped stylesheet.
function ruleBody(selector: string): string {
  const css = styleSheet().replace(/\s+/g, ' ');
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}

const hints = (root: ShadowRoot) => [...root.querySelectorAll<HTMLElement>(`.${CLASS.hint}`)];
const visible = (root: ShadowRoot) => hints(root).filter((hint) => !hint.hidden);
const enter = (target: EventTarget = document.body, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      composed: true,
      cancelable: true,
      ...init,
    }),
  );

describe('drawing hint Send', () => {
  it('sends drawings from the hint instead of the palette', async () => {
    const { root, sent, send, draw, open } = setup();
    await open();
    draw(arrow, box);
    const button = send()!;
    expect(button.closest('.pb-palette')).toBeNull();
    expect(root.querySelector('.pb-palette [data-act="send"]')).toBeNull();
    expect(visible(root)).toHaveLength(1);
    const hint = visible(root)[0]!;
    expect(hint.contains(button)).toBe(true);
    expect(hint.textContent).toContain('Esc to leave · Enter to send');
    expect(hint.textContent).not.toContain('Click anything');
    expect(button.title).toBe('Send all');
    expect(button.getAttribute('aria-label')).toBe('Send');
    expect(button.getAttribute('part')).toBe('tool tool-send');
    expect(hint.lastElementChild).toBe(button);
    button.click();
    await flush();
    expect(sent).toEqual([
      {
        comment: drawingComment(window.location.pathname),
        selector: 'body',
        offset: { x: 0, y: 0 },
        element: document.body,
        marks: [],
      },
    ]);
    expect(send()).toBeNull();
  });

  it('Enter sends the eligible drawing once', async () => {
    let resolve: (value?: unknown) => void = () => undefined;
    const { sent, send, draw, open } = setup(() => new Promise((done) => (resolve = done)));
    await open();
    draw(arrow);
    expect(enter()).toBe(false);
    enter();
    enter();
    await flush();
    expect(send()).toBeNull();
    resolve();
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.selector).toBe('body');
  });

  it('keeps one hint across armed drawing and composing transitions', async () => {
    const { root, step, send, open } = setup();
    expect(visible(root).map((hint) => hint.textContent)).toEqual([
      'Click anything to comment · Esc to leave',
    ]);
    await open();
    expect(visible(root)).toHaveLength(1);
    expect(visible(root)[0]!.textContent).toContain('Esc to leave · Enter to send');
    expect(send()!.disabled).toBe(true);
    step.toggle(false);
    expect(visible(root).map((hint) => hint.textContent)).toEqual([
      'Click anything to comment · Esc to leave',
    ]);
    expect(hints(root)).toHaveLength(1);
    step.toggle(true);
    step.toggle(false);
    step.toggle(true);
    expect(visible(root)).toHaveLength(1);
    expect(hints(root).filter((hint) => hint.dataset.draw !== undefined)).toHaveLength(1);
    step.toggle(false);
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await flush();
    expect(root.querySelector(`.${CLASS.bubble}`)).not.toBeNull();
    expect(hints(root)).toHaveLength(0);
    await open();
    expect(hints(root)).toHaveLength(0);
  });

  it('keeps only the hint send button interactive', async () => {
    const { root, draw, open } = setup();
    await open();
    draw(arrow);
    const hint = visible(root)[0]!;
    const button = hint.querySelector<HTMLButtonElement>('button[data-act="send"]')!;
    const text = hint.querySelector<HTMLElement>('span')!;
    expect(hint.hasAttribute('data-draw')).toBe(true);
    expect(text.textContent).toBe('Esc to leave · Enter to send');
    expect(hint.lastElementChild).toBe(button);
    // The host is click-through; only the hint's own button takes the pointer back.
    expect(ruleBody(':host')).toContain('pointer-events: none');
    expect(ruleBody(`.${CLASS.hint}`)).not.toContain('pointer-events');
    expect(ruleBody(`.${CLASS.hint}[data-draw] > span`)).not.toContain('pointer-events');
    const send = ruleBody(`.${CLASS.hint}[data-draw] button[data-act='send']`);
    expect(send).toContain('pointer-events: auto');
    const css = styleSheet().replace(/\s+/g, ' ');
    const grabbing = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(
        ([, selector, body]) =>
          selector!.includes(`.${CLASS.hint}`) && /pointer-events: auto/.test(body!),
      )
      .map(([, selector]) => selector!.trim());
    expect(grabbing).toEqual([`.${CLASS.hint}[data-draw] button[data-act='send']`]);
    // The text wraps and shrinks so the button keeps its size at the right end inside the hint.
    expect(ruleBody(`.${CLASS.hint}[data-draw]`)).toContain('display: flex');
    const span = ruleBody(`.${CLASS.hint}[data-draw] > span`);
    expect(span).toContain('min-width: 0');
    expect(span).toContain('white-space: normal');
    expect(send).toContain('flex: none');
    for (const value of send.matchAll(/:\s*([^;]+);/g)) {
      if (/#|\d+px/.test(value[1]!)) throw new Error(`untokened value ${value[1]}`);
    }
    // Flush against the top edge, centred, in every corner.
    const base = ruleBody(`.${CLASS.hint}`);
    expect(base).toContain('top: 0');
    expect(base).toContain('left: 50%');
    expect(base).toContain('max-width: calc(100% - 24px)');
    expect(hint.hasAttribute('data-corner')).toBe(true);
  });

  it('hint send preserves empty and ineligible drawing guards', async () => {
    const { root, overlay, sent, send, draw, open } = setup();
    await open();
    expect(send()!.disabled).toBe(true);
    enter();
    await flush();
    expect(sent).toEqual([]);
    draw(arrow);
    expect(send()!.disabled).toBe(false);
    shapes = [];
    change(0);
    expect(send()!.disabled).toBe(true);
    draw(arrow);
    const input = root.appendChild(document.createElement('input'));
    enter(input);
    enter(document.body, { shiftKey: true });
    await flush();
    expect(sent).toEqual([]);
    const stale = send()!;
    shapes = [];
    stale.click();
    await flush();
    expect(sent).toEqual([]);
    draw(box);
    overlay.destroy();
    expect(send()).toBeNull();
    enter();
    await flush();
    expect(sent).toEqual([]);
  });

  it('hint send preserves retry acknowledgement and disposal', async () => {
    const ready = vi.fn<() => Promise<unknown>>(() => Promise.reject(new Error('offline')));
    const { root, step, overlay, sent, send, draw, open } = setup(ready);
    await open();
    draw(arrow);
    const relocated = send()!;
    relocated.click();
    relocated.click();
    enter();
    await flush();
    expect(ready).toHaveBeenCalledTimes(1);
    expect(root.textContent).toContain('offline');
    expect(visible(root).filter((hint) => hint.dataset.draw !== undefined)).toHaveLength(0);
    ready.mockImplementation(() => Promise.resolve());
    root.querySelector<HTMLButtonElement>(`.${CLASS.send}`)!.click();
    await flush();
    expect(sent).toHaveLength(1);
    overlay.failed('upload rejected');
    await flush();
    expect(root.textContent).toContain('upload rejected');
    enter();
    await flush();
    expect(sent).toHaveLength(1);
    root.querySelector<HTMLButtonElement>(`.${CLASS.send}`)!.click();
    await flush();
    expect(sent).toHaveLength(2);
    expect(sent[1]!.selector).toBe('body');
    overlay.acked('item-1', false);
    expect(overlay.phase()).toBe('idle');
    expect(send()).toBeNull();
    expect(hints(root)).toHaveLength(0);

    document.body.innerHTML = '';
    let resolve: (value?: unknown) => void = () => undefined;
    const late = setup(() => new Promise((done) => (resolve = done)));
    await late.open();
    late.draw(arrow);
    late.send()!.click();
    await flush();
    late.step.close();
    resolve();
    await flush();
    expect(late.sent).toEqual([]);
    expect(hints(late.root).filter((hint) => hint.dataset.draw !== undefined)).toHaveLength(0);
    enter();
    expect(late.sent).toEqual([]);
    late.overlay.destroy();

    document.body.innerHTML = '';
    let settle: (value?: unknown) => void = () => undefined;
    const torn = setup(() => new Promise((done) => (settle = done)));
    await torn.open();
    torn.draw(box);
    torn.send()!.click();
    await flush();
    torn.overlay.destroy();
    settle();
    await flush();
    expect(torn.sent).toEqual([]);
    expect(hints(torn.root)).toHaveLength(0);
    enter();
    expect(torn.sent).toEqual([]);
    step.close();
  });
});
