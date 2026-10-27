// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOverlay, type Overlay } from './overlay';
import { mountInk, type Ink } from './shot-ink';
import { grabViewport } from './shot-grab';
import { openShot } from './shot';
import { drawingComment } from './shot-send';
import { createShotStep, drawingOf } from './shot-step';
import { armWidget } from './test-arm';
import { CLASS } from './styles';
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
  vi.mocked(grabViewport).mockResolvedValue({ ok: false } as never);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))),
  );
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
      void step.finish(detail.element).then(finished);
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

describe('drawing-only Send', () => {
  it('files every drawing against body without painting a mark', async () => {
    const { root, sent, finished, send, draw, open } = setup();
    await open();
    draw(arrow, box);
    expect(send()!.getAttribute('aria-label')).toBe('Send');
    send()!.click();
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
    expect(root.querySelector(`.${CLASS.dot}`)).toBeNull();
    const call = vi.mocked(grabViewport).mock.calls[0]![0];
    expect(call.marks).toEqual([]);
    expect(call.shapes).toEqual([arrow, box]);
    expect(finished).toHaveBeenCalledOnce();
    expect(finished.mock.calls[0]![0].annotations).toHaveLength(2);
    expect(send()).toBeNull();
  });

  it('disables drawing Send until a completed shape exists', async () => {
    const { overlay, sent, send, draw, open } = setup();
    expect(send()).toBeNull();
    await open();
    expect(send()!.disabled).toBe(true);
    draw(arrow);
    expect(send()!.disabled).toBe(false);
    draw(box);
    shapes = shapes.slice(0, -1);
    change(shapes.length);
    expect(send()!.disabled).toBe(false);
    shapes = [];
    change(0);
    expect(send()!.disabled).toBe(true);
    send()!.click();
    await flush();
    expect(sent).toEqual([]);
    // A control that went stale is never trusted: the shapes vanish without a signal.
    draw(arrow);
    const button = send()!;
    shapes = [];
    button.click();
    await flush();
    expect(sent).toEqual([]);
    expect(overlay.phase()).toBe('armed');
  });

  it('uses only pathname for the drawing comment', async () => {
    expect(drawingComment('/a/b')).toBe('Drawing on /a/b');
    window.history.pushState({}, '', '/docs/page?q=1#frag');
    const { sent, send, draw, open } = setup();
    await open();
    draw(arrow);
    send()!.click();
    await flush();
    expect(sent[0]!.comment).toBe('Drawing on /docs/page');
  });

  it('reuses drawing error Retry and acknowledgement paths', async () => {
    const ready = vi.fn<() => Promise<unknown>>(() =>
      Promise.reject(new Error('collectors offline')),
    );
    const { root, overlay, sent, send, draw, open } = setup(ready);
    await open();
    draw(arrow);
    send()!.click();
    await flush();
    expect(root.textContent).toContain('collectors offline');
    expect(sent).toEqual([]);
    const retry = root.querySelector<HTMLButtonElement>(`.${CLASS.send}`)!;
    expect(retry.textContent).toBe('Retry');
    ready.mockImplementation(() => Promise.resolve());
    retry.click();
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.selector).toBe('body');
    overlay.acked('item-1', false);
    expect(overlay.phase()).toBe('idle');
    expect(send()).toBeNull();
  });

  it('drops drawing controls and late loads after disposal', async () => {
    const first = setup();
    await first.open();
    first.draw(arrow);
    expect(first.send()).not.toBeNull();
    first.step.close();
    expect(first.send()).toBeNull();
    first.overlay.arm();
    expect(first.send()).toBeNull();

    document.body.innerHTML = '';
    const second = setup();
    second.step.toggle(true);
    second.step.close();
    await flush();
    expect(vi.mocked(mountInk)).toHaveBeenCalledTimes(1);
    expect(second.send()).toBeNull();

    // Closed while readiness is pending: the owner goes and the late outcome sends nothing.
    document.body.innerHTML = '';
    let resolve: (value?: unknown) => void = () => undefined;
    const third = setup(() => new Promise((done) => (resolve = done)));
    await third.open();
    third.draw(arrow);
    third.send()!.click();
    await flush();
    expect(third.root.querySelector(`.${CLASS.bubble}`)).not.toBeNull();
    third.step.close();
    expect(third.root.querySelector(`.${CLASS.bubble}`)).toBeNull();
    resolve();
    await flush();
    expect(third.sent).toEqual([]);
    third.overlay.destroy();

    // Handed off: the owner waits for its acknowledgement, then leaves with the overlay.
    document.body.innerHTML = '';
    const fourth = setup();
    await fourth.open();
    fourth.draw(arrow);
    fourth.send()!.click();
    await flush();
    expect(fourth.sent).toHaveLength(1);
    fourth.overlay.acked('item-2', false);
    expect(fourth.root.querySelector(`.${CLASS.bubble}`)).not.toBeNull();
    fourth.step.close();
    await flush();
    expect(fourth.root.querySelector(`.${CLASS.bubble}`)).not.toBeNull();
    // Arming again lets go of the acknowledged owner, so the next drawing gets its own Send.
    fourth.overlay.arm();
    await fourth.open();
    expect(fourth.root.querySelector(`.${CLASS.bubble}`)).toBeNull();
    fourth.draw(box);
    expect(fourth.send()?.disabled).toBe(false);
    fourth.send()!.click();
    await flush();
    expect(fourth.sent).toHaveLength(2);
    fourth.overlay.destroy();
    await flush();
    expect(fourth.root.querySelector(`.${CLASS.bubble}`)).toBeNull();
  });
});
