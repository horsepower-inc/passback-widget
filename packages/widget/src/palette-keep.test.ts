// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolveTarget } from '@passback/collectors';
import type { SendResult } from './send';
import { HOST_ATTRIBUTE } from './mount';
import { CLASS } from './styles';
import { armWidget } from './test-arm';
import { openShot } from './shot';
import { palette } from './palette';
import type { Widget } from './index';

type Passback = { autoStart: boolean; collect?: unknown; shot?: unknown; fx?: unknown };

function fakeCollector() {
  return {
    send: vi.fn(async (): Promise<SendResult> => ({ ok: true, id: 'abc', trimmed: false })),
    selectorOf: vi.fn(() => '#save'),
    targetOf: vi.fn(() => ({ selectors: [], tag: 'div', text: '' }) as ResolveTarget),
    reresolve: vi.fn(() => null),
    dispose: vi.fn(),
  };
}

let widgets: Widget[] = [];

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

async function armedRoot(): Promise<ShadowRoot> {
  const script = document.createElement('script');
  script.setAttribute('data-passback-endpoint', '/m');
  script.setAttribute('data-passback-shot', '/shot.js');
  script.setAttribute('data-passback-screenshots', 'true');
  document.head.appendChild(script);
  (window as unknown as { __passback?: Passback }).__passback = {
    autoStart: false,
    shot: openShot,
    fx: { addons: [palette] },
    collect: () => fakeCollector(),
  };
  const { start } = await import('./index');
  widgets.push(start());
  const root = document.querySelector<HTMLElement>(`[${HOST_ATTRIBUTE}]`)!.shadowRoot!;
  armWidget(root);
  await settle();
  return root;
}

const tool = (root: ShadowRoot, name: string): HTMLButtonElement =>
  root.querySelector<HTMLButtonElement>(`.pb-palette [data-tool="${name}"]`)!;

function draw(root: ShadowRoot): void {
  const ink = root.querySelector('svg[data-role="ink"]')!;
  const init = { pointerId: 1, button: 0, bubbles: true };
  const at = (type: string, x: number, y: number) =>
    ink.dispatchEvent(new PointerEvent(type, { ...init, clientX: x, clientY: y }));
  at('pointerdown', 10, 10);
  at('pointermove', 60, 40);
  at('pointerup', 90, 60);
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 404 })),
  );
});

afterEach(() => {
  widgets.forEach((widget) => widget.stop());
  widgets = [];
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  delete (window as unknown as { __passback?: Passback }).__passback;
  vi.unstubAllGlobals();
});

const clear = (root: ShadowRoot): HTMLButtonElement =>
  root.querySelector<HTMLButtonElement>('.pb-palette [data-act="clear"]')!;
const paths = (root: ShadowRoot): number =>
  root.querySelectorAll('svg[data-role="ink"] path').length;

// Box, a drag, then Point on a page element and a typed comment: the mark is pinned, one shape drawn.
function boxThenComment(root: ShadowRoot): HTMLTextAreaElement {
  tool(root, 'box').click();
  draw(root);
  tool(root, 'point').click();
  const target = document.createElement('div');
  target.id = 'save';
  document.body.appendChild(target);
  const click = { bubbles: true, cancelable: true, composed: true, clientX: 15, clientY: 27 };
  target.dispatchEvent(new MouseEvent('click', click));
  const input = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
  Object.assign(input, { value: 'note' }).dispatchEvent(new Event('input'));
  return input;
}

const escape = (input: HTMLElement) =>
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

describe('shapes stay on the page until Send or Clear all', () => {
  it('Add more keeps the shapes and Clear all enabled', async () => {
    const root = await armedRoot();
    boxThenComment(root);
    root.querySelector<HTMLElement>('[data-role="add-more"]')!.click();
    expect(paths(root)).toBe(1);
    expect(clear(root).disabled).toBe(false);
    tool(root, 'line').click();
    draw(root);
    expect(paths(root)).toBe(2);
  });

  it('Escape on a comment keeps the shapes', async () => {
    const root = await armedRoot();
    escape(boxThenComment(root));
    expect(paths(root)).toBe(1);
  });

  it('Clear all removes every shape and disables itself', async () => {
    const root = await armedRoot();
    tool(root, 'box').click();
    draw(root);
    tool(root, 'line').click();
    draw(root);
    expect(paths(root)).toBe(2);
    clear(root).click();
    expect(paths(root)).toBe(0);
    expect(clear(root).disabled).toBe(true);
  });

  it('discard keeps the shapes', async () => {
    const root = await armedRoot();
    boxThenComment(root);
    root.querySelector<HTMLElement>('[data-role="discard"]')!.click();
    expect(paths(root)).toBe(1);
  });

  it('Reopening the widget from the ball shows the palette with Clear all enabled', async () => {
    const root = await armedRoot();
    escape(boxThenComment(root));
    root.querySelector<HTMLElement>(`.${CLASS.launcher}`)!.click();
    expect(root.querySelector('.pb-palette')!.hasAttribute('data-open')).toBe(true);
    expect(clear(root).disabled).toBe(false);
    expect(paths(root)).toBe(1);
  });
});
