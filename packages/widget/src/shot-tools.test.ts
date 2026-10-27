// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mountTools, type Tools } from './shot-tools';

let host: HTMLElement;
let root: ShadowRoot;
let tools: Tools;
const onTool = vi.fn();
const onUndo = vi.fn();
const onClear = vi.fn();
const buttons = () => Array.from(root.querySelectorAll('button'));
const flat = (value: string) => value.replace(/,\s+/g, ',');

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.append(host);
  root = host.attachShadow({ mode: 'open' });
  tools = mountTools(root, { side: 'right', tool: 'line', onTool, onUndo, onClear });
});

afterEach(() => {
  tools.destroy();
  host.remove();
});

it('shows Arrow, Line, Box, Undo and Clear all in that order, each with a name and an icon', () => {
  expect(tools.element.getAttribute('role')).toBe('toolbar');
  expect(tools.element.getAttribute('aria-label')).toBe('Drawing tools');
  expect(tools.element.dataset.role).toBe('tools');
  expect(buttons().map((button) => button.title)).toEqual([
    'Arrow',
    'Line',
    'Box',
    'Undo',
    'Clear all',
  ]);
  const paths = [
    'M3 13L13 3M7.5 3H13v5.5',
    'M3 13L13 3',
    'M3.5 4h9a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z',
    'M4 7h5.5a3 3 0 0 1 0 6H7M4 7l3-3M4 7l3 3',
    'M290.7 57.4L57.4 290.7c-25 25-25 65.5 0 90.5l80 80c12 12 28.3 18.7 45.3 18.7H288h9.4H512c17.7 0 32-14.3 32-32s-14.3-32-32-32H387.9L518.6 285.3c25-25 25-65.5 0-90.5L381.3 57.4c-25-25-65.5-25-90.5 0zM297.4 416H288l-105.4 0-80-80L227.3 211.3 364.7 348.7 297.4 416z',
  ];
  buttons().forEach((button, index) => {
    expect(button.type).toBe('button');
    expect(button.getAttribute('aria-label')).toBe(button.title);
    const svg = button.querySelector('svg')!;
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(svg.getAttribute('viewBox')).toBe(index === 4 ? '0 0 576 512' : '0 0 16 16');
    expect(svg.getAttribute('width')).toBe('16');
    expect(svg.getAttribute('height')).toBe('16');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelector('path')?.getAttribute('d')).toBe(paths[index]);
    expect(button.querySelectorAll('svg')).toHaveLength(1);
  });
  expect(buttons().map((button) => button.dataset.tool ?? button.dataset.act)).toEqual([
    'arrow',
    'line',
    'box',
    'undo',
    'clear',
  ]);
});

it('draws Clear all as the filled eraser, not a cross, with its name and part unchanged', () => {
  const clear = buttons()[4]!;
  const svg = clear.querySelector('svg')!;
  expect(svg.style.fill).toBe('currentColor');
  expect(svg.style.stroke).toBe('none');
  expect(svg.querySelector('path')?.getAttribute('d')).not.toBe('M4 4l8 8M12 4l-8 8');
  expect(clear.getAttribute('aria-label')).toBe('Clear all');
  expect(clear.dataset.act).toBe('clear');
  expect(clear.getAttribute('part')).toBe('tool tool-clear');
  tools.setCount(1);
  clear.click();
  expect(onClear).toHaveBeenCalledTimes(1);
});

it('makes every button round and 32 px', () => {
  for (const button of buttons()) {
    expect(button.style.width).toBe('32px');
    expect(button.style.height).toBe('32px');
    expect(button.style.borderRadius).toBe('50%');
    expect(button.style.padding).toBe('0px');
    expect(button.style.display).toBe('grid');
    expect(button.style.placeItems).toBe('center');
    expect(flat(button.style.boxShadow)).toBe('var(--pb-shadow-box,0 6px 20px rgba(0,0,0,.22))');
  }
});

it('fills the starting tool and moves the pressed state on a click', () => {
  const arrow = buttons()[0]!;
  const line = buttons()[1]!;
  const box = buttons()[2]!;
  expect([arrow, line, box].map((button) => button.getAttribute('aria-pressed'))).toEqual([
    'false',
    'true',
    'false',
  ]);
  expect(flat(line.style.background)).toBe('var(--pb-color-main,#f4f4f5)');
  expect(flat(line.style.borderColor)).toBe('var(--pb-color-main,#f4f4f5)');
  expect(flat(line.style.color)).toBe('var(--pb-color-on-main,#17181c)');
  box.click();
  expect([arrow, line, box].map((button) => button.getAttribute('aria-pressed'))).toEqual([
    'false',
    'false',
    'true',
  ]);
  expect(flat(box.style.background)).toBe('var(--pb-color-main,#f4f4f5)');
  expect(flat(line.style.background)).toBe('var(--pb-color-surface,#17181c)');
  expect(flat(line.style.borderColor)).toBe('var(--pb-color-border,#33363d)');
  expect(flat(line.style.color)).toBe('var(--pb-color-text,#f4f4f5)');
});

it('reports a tool change, undo and clear', () => {
  buttons()[0]!.click();
  expect(onTool).toHaveBeenCalledExactlyOnceWith('arrow');
  tools.setCount(2);
  buttons()[3]!.click();
  buttons()[4]!.click();
  expect(onUndo).toHaveBeenCalledExactlyOnceWith();
  expect(onClear).toHaveBeenCalledExactlyOnceWith();
});

it('disables Undo and Clear all while nothing is drawn', () => {
  const actions = buttons().slice(3);
  for (const button of actions) {
    expect(button.disabled).toBe(true);
    expect(Number(button.style.opacity)).toBe(0.45);
    expect(button.style.cursor).toBe('default');
    button.click();
  }
  expect(onUndo).not.toHaveBeenCalled();
  expect(onClear).not.toHaveBeenCalled();
  tools.setCount(1);
  for (const button of actions) {
    expect(button.disabled).toBe(false);
    expect(Number(button.style.opacity)).toBe(1);
    expect(button.style.cursor).toBe('pointer');
  }
  tools.setCount(0);
  expect(actions.every((button) => button.disabled)).toBe(true);
  expect(
    buttons()
      .slice(0, 3)
      .every((button) => !button.disabled),
  ).toBe(true);
});

it('sits beside the launcher on the side it is given', () => {
  expect(tools.element.style.position).toBe('fixed');
  expect(tools.element.style.bottom).toBe('14px');
  expect(tools.element.style.display).toBe('flex');
  expect(tools.element.style.gap).toBe('6px');
  expect(tools.element.style.pointerEvents).toBe('auto');
  expect(tools.element.style.right).toBe('calc(var(--pb-size-launcher,36px) + 24px)');
  expect(tools.element.style.left).toBe('');
  tools.destroy();
  tools = mountTools(root, { side: 'left', tool: 'arrow', onTool, onUndo, onClear });
  expect(tools.element.style.left).toBe('calc(var(--pb-size-launcher,36px) + 24px)');
  expect(tools.element.style.right).toBe('');
});

it('removes the bar on destroy, also when called twice', () => {
  const sibling = document.createElement('div');
  root.append(sibling);
  expect(root.contains(tools.element)).toBe(true);
  tools.destroy();
  tools.destroy();
  expect(root.querySelector('[data-role="tools"]')).toBeNull();
  expect(root.contains(sibling)).toBe(true);
});

it('R2 adds its buttons to a given toolbar without its own look and removes only them', () => {
  const parent = document.createElement('div');
  const point = document.createElement('button');
  point.dataset.tool = 'point';
  parent.append(point);
  root.append(parent);
  const given = mountTools(root, { side: 'right', tool: 'box', onTool, onUndo, onClear, parent });
  const own = Array.from(parent.querySelectorAll('button')).slice(1);
  expect(given.element).toBe(parent);
  expect(own).toHaveLength(5);
  expect(own.map((button) => button.style.getPropertyValue('--pb-i'))).toEqual([
    '1',
    '2',
    '3',
    '4',
    '5',
  ]);
  expect(parent.getAttribute('role')).toBeNull();
  expect(parent.style.cssText).toBe('');
  for (const button of own) {
    expect(button.style.width).toBe('');
    expect(button.style.background).toBe('');
  }
  expect(own[2]!.getAttribute('aria-pressed')).toBe('true');
  expect(own[2]!.style.color).toBe('');
  expect(point.hasAttribute('aria-pressed')).toBe(false);
  expect(own[3]!.disabled).toBe(true);
  expect(own[3]!.style.opacity).toBe('');
  given.setCount(1);
  expect(own[3]!.disabled).toBe(false);
  expect(own[0]!.disabled).toBe(false);
  own[0]!.click();
  expect(onTool).toHaveBeenCalledExactlyOnceWith('arrow');
  given.destroy();
  expect(parent.querySelectorAll('button')).toHaveLength(1);
  expect(root.contains(parent)).toBe(true);
});
