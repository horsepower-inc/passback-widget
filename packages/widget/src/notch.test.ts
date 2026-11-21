// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOverlay, type Overlay } from './overlay';
import { mountInk, type Ink } from './shot-ink';
import { grabViewport } from './shot-grab';
import { uploadShot } from './shot-upload';
import { openShot } from './shot';
import { createOutline } from './dot-view';
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

function ruleBody(selector: string): string {
  const css = styleSheet().replace(/\s+/g, ' ');
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}

const visible = (root: ShadowRoot) =>
  [...root.querySelectorAll<HTMLElement>(`.${CLASS.hint}`)].filter((hint) => !hint.hidden);
const enter = () =>
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true, cancelable: true }),
  );

describe('notch', () => {
  it('the hint is a notch in the main colour flush with the top edge in every corner', () => {
    for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
      const host = document.body.appendChild(document.createElement('div'));
      const root = host.attachShadow({ mode: 'open' });
      const launcher = root.appendChild(document.createElement('div'));
      launcher.className = 'pb-launcher';
      launcher.setAttribute('data-corner', corner);
      createOutline(root);
      expect(root.querySelector('[part="hint"]')).not.toBeNull();
    }
    const base = ruleBody(`.${CLASS.hint}`);
    expect(base).toContain('top: 0');
    expect(base).toContain('left: 50%');
    expect(base).toContain('background: var(--pb-color-main)');
    expect(base).toContain('color: var(--pb-color-on-main)');
    expect(base).toContain('border: none');
    expect(base).not.toContain('box-shadow');
    expect(base).toMatch(/border-radius: 0 0 /);
    expect(base).toContain('animation: pb-notch-in');
    expect(styleSheet()).not.toContain('[data-corner^=');
    expect(styleSheet()).toContain(`.${CLASS.hint}::before`);
    expect(styleSheet()).toContain(`.${CLASS.hint}::after`);
  });

  it('Send all is a pill in the opposite colour with the number of drawings', async () => {
    const { root, send, draw, open } = setup();
    await open();
    draw(arrow, box);
    const button = send()!;
    expect(button.hidden).toBe(false);
    expect(button.textContent).toContain('Send all');
    expect(button.querySelector('[data-count]')!.textContent).toBe('2');
    const pill = ruleBody(`.${CLASS.hint}[data-draw] button[data-act='send']`);
    expect(pill).toContain('background: var(--pb-color-on-main)');
    expect(pill).toContain('color: var(--pb-color-main)');
    expect(pill).toContain('font-weight: bold');
    expect(pill).toContain('border-radius: var(--pb-size-launcher)');
    draw(arrow);
    expect(button.querySelector('[data-count]')!.textContent).toBe('3');
    expect(visible(root)).toHaveLength(1);
  });

  it('Send all is not shown until there is a drawing and Enter sends nothing then', async () => {
    const { sent, send, draw, open } = setup();
    await open();
    expect(send()!.hidden).toBe(true);
    enter();
    await flush();
    expect(sent).toEqual([]);
    draw(arrow);
    expect(send()!.hidden).toBe(false);
    expect(styleSheet()).toContain(`button[data-act='send'][hidden]`);
  });

  it('the notch keeps only the short hint on a narrow screen', async () => {
    const { root, open } = setup();
    const armed = visible(root)[0]!;
    expect(armed.textContent).toBe('Click anything to comment · Esc to leave');
    expect(armed.querySelector('[data-long]')!.textContent).toBe('Click anything to comment · ');
    await open();
    const drawing = visible(root)[0]!;
    expect(drawing.textContent).toContain('Esc to leave · Enter to send');
    expect(drawing.querySelector('[data-long]')).toBeNull();
    const css = styleSheet().replace(/\s+/g, ' ');
    const media = css.indexOf('@media (max-width: 480px)');
    expect(media).toBeGreaterThanOrEqual(0);
    expect(css.slice(media, css.indexOf('}', css.indexOf('}', media) + 1))).toContain(
      `.${CLASS.hint} [data-long] { display: none; }`,
    );
    expect(ruleBody(`.${CLASS.hint}`)).toContain('max-width: calc(100% - 24px)');
  });
});
