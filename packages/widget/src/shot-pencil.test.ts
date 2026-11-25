// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createOverlay, type Overlay } from './overlay';
import { palette } from './palette';
import { mountInk, type Ink } from './shot-ink';
import { SHAPE_MAX, pushShape, shapePath, shiftShapes, type Shape, type Tool } from './shot-shapes';
import { mountTools } from './shot-tools';

let host: HTMLElement;
let root: ShadowRoot;
let svg: SVGSVGElement;
let ink: Ink;
let overlay: Overlay | undefined;
const changed = vi.fn();
const scope = globalThis as { __passback?: unknown };

function pointer(type: string, x: number, y: number): void {
  svg.dispatchEvent(
    new PointerEvent(type, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function scribble(points: [number, number][]): void {
  const [first, ...rest] = points;
  pointer('pointerdown', first![0], first![1]);
  for (const [x, y] of rest) pointer('pointermove', x, y);
  const last = points[points.length - 1]!;
  pointer('pointerup', last[0], last[1]);
}

const wave: [number, number][] = [
  [10, 20],
  [20, 40],
  [30, 15],
  [45, 50],
];

beforeEach(() => {
  changed.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = host.attachShadow({ mode: 'open' });
  ink = mountInk(root, window, changed);
  svg = root.querySelector('svg')!;
});

afterEach(() => {
  ink.destroy();
  overlay?.destroy();
  overlay = undefined;
  delete scope.__passback;
  document.body.innerHTML = '';
});

it('a pencil stroke is drawn as a freehand path', () => {
  scribble(wave);
  const [shape] = ink.shapes();
  expect(shape?.tool).toBe('pencil');
  expect(shape?.path).toEqual(wave.map(([x, y]) => ({ x, y })));
  expect(svg.children).toHaveLength(1);
  expect(svg.firstElementChild?.getAttribute('d')).toBe('M10 20L20 40L30 15L45 50');
  expect(changed.mock.calls).toEqual([[1]]);
});

it('the pencil is the first drawing tool and the starting tool', () => {
  expect(ink.tool).toBe('pencil');
  const tools = mountTools(root, {
    side: 'right',
    tool: ink.tool,
    onTool: (tool: Tool) => (ink.tool = tool),
    onUndo: vi.fn(),
    onClear: vi.fn(),
  });
  const buttons = Array.from(tools.element.querySelectorAll('button'));
  expect(buttons.map((b) => b.title)).toEqual([
    'Pencil',
    'Arrow',
    'Line',
    'Box',
    'Undo',
    'Clear all',
  ]);
  const first = buttons[0]!;
  expect(first.getAttribute('aria-label')).toBe('Pencil');
  expect(first.getAttribute('part')).toBe('tool tool-pencil tool-on');
  expect(first.getAttribute('aria-pressed')).toBe('true');
  expect(buttons[1]!.getAttribute('aria-pressed')).toBe('false');
  tools.destroy();
});

it('the palette presses the pencil when drawing starts without a chosen tool', () => {
  scope.__passback = { fx: { addons: [palette] } };
  overlay = createOverlay({
    doc: document,
    root,
    host,
    selectorOf: (el) => el.tagName.toLowerCase(),
    onSubmit: vi.fn(),
    drawing: { toggle: vi.fn(), cancel: vi.fn() },
  });
  const bar = root.querySelector<HTMLElement>('.pb-palette')!;
  const add = (tool: string): HTMLButtonElement => {
    const button = document.createElement('button');
    button.dataset.tool = tool;
    button.setAttribute('aria-pressed', 'false');
    bar.append(button);
    return button;
  };
  const pencil = add('pencil');
  const arrow = add('arrow');
  root.querySelector<HTMLButtonElement>('.pb-launcher')!.click();
  document.body.appendChild(document.createElement('p')).click();
  pencil.click();
  expect(bar.dataset.shape).toBe('pencil');
  expect(pencil.getAttribute('aria-pressed')).toBe('true');
  expect(arrow.getAttribute('aria-pressed')).toBe('false');
});

it('a pencil stroke moves with the page scroll and paints at the picture scale', () => {
  const shape: Shape = {
    tool: 'pencil',
    from: { x: 10, y: 20 },
    to: { x: 30, y: 40 },
    path: [
      { x: 10, y: 20 },
      { x: 20, y: 40 },
      { x: 30, y: 40 },
    ],
  };
  const [moved] = shiftShapes([shape], -5, 10);
  expect(moved?.path).toEqual([
    { x: 5, y: 30 },
    { x: 15, y: 50 },
    { x: 25, y: 50 },
  ]);
  expect(moved?.from).toEqual({ x: 5, y: 30 });
  expect(shape.path![0]).toEqual({ x: 10, y: 20 });
  expect(shapePath(moved!, 2)).toBe('M10 60L30 100L50 100');
});

it('a tap or a tiny scribble is not a stroke', () => {
  const dot = { x: 5, y: 5 };
  expect(pushShape([], { tool: 'pencil', from: dot, to: dot, path: [dot] })).toEqual([]);
  const tiny: [number, number][] = [
    [5, 5],
    [8, 7],
    [6, 9],
    [5, 5],
  ];
  scribble(tiny);
  scribble([[5, 5]]);
  expect(ink.shapes()).toEqual([]);
  expect(changed).not.toHaveBeenCalled();
  for (let i = 0; i < SHAPE_MAX + 2; i++) scribble(wave);
  expect(ink.shapes()).toHaveLength(SHAPE_MAX);
});

it('Escape, a cancelled pointer and Undo drop the pencil stroke', () => {
  pointer('pointerdown', 10, 20);
  pointer('pointermove', 40, 60);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
  pointer('pointerup', 40, 60);
  expect(ink.shapes()).toEqual([]);
  expect(svg.children).toHaveLength(0);
  pointer('pointerdown', 10, 20);
  pointer('pointermove', 40, 60);
  pointer('pointercancel', 40, 60);
  pointer('pointerup', 40, 60);
  expect(ink.shapes()).toEqual([]);
  scribble(wave);
  scribble(wave);
  ink.undo();
  expect(ink.shapes()).toHaveLength(1);
  ink.undo();
  expect(ink.shapes()).toEqual([]);
  expect(svg.children).toHaveLength(0);
});
