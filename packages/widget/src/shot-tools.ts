import type { Tool } from './shot-shapes';

export type ToolsOptions = {
  side: 'left' | 'right';
  tool: Tool;
  onTool(tool: Tool): void;
  onUndo(): void;
  onClear(): void;
  parent?: HTMLElement;
};
export type Tools = { element: HTMLElement; setCount(count: number): void; destroy(): void };

// Eraser glyph: Font Awesome Free 6.5.2 "eraser" (solid) by Fonticons, Inc., CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).
const eraser =
  'M290.7 57.4L57.4 290.7c-25 25-25 65.5 0 90.5l80 80c12 12 28.3 18.7 45.3 18.7H288h9.4H512c17.7 0 32-14.3 32-32s-14.3-32-32-32H387.9L518.6 285.3c25-25 25-65.5 0-90.5L381.3 57.4c-25-25-65.5-25-90.5 0zM297.4 416H288l-105.4 0-80-80L227.3 211.3 364.7 348.7 297.4 416z';
const filled = { viewBox: '0 0 576 512', style: 'fill:currentColor;stroke:none' };
const buttons: {
  name: string;
  tool?: Tool;
  act?: 'undo' | 'clear';
  path: string;
  filled?: typeof filled;
}[] = [
  { name: 'Arrow', tool: 'arrow', path: 'M3 13L13 3M7.5 3H13v5.5' },
  { name: 'Line', tool: 'line', path: 'M3 13L13 3' },
  {
    name: 'Box',
    tool: 'box',
    path: 'M3.5 4h9a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z',
  },
  { name: 'Undo', act: 'undo', path: 'M4 7h5.5a3 3 0 0 1 0 6H7M4 7l3-3M4 7l3 3' },
  { name: 'Clear all', act: 'clear', path: eraser, filled },
];
const buttonStyle =
  'width:32px;height:32px;padding:0;display:grid;place-items:center;border:1px solid var(--pb-color-border,#33363d);border-radius:50%;background:var(--pb-color-surface,#17181c);color:var(--pb-color-text,#f4f4f5);box-shadow:var(--pb-shadow-box,0 6px 20px rgba(0,0,0,.22));cursor:pointer';

function icon(pathData: string, fill?: typeof filled): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', fill?.viewBox ?? '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText =
    fill?.style ??
    'fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round';
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', pathData);
  svg.append(path);
  return svg;
}

function press(element: HTMLElement, tool: Tool, own: boolean): void {
  for (const button of element.querySelectorAll<HTMLButtonElement>(
    own ? '[data-tool]:not([data-tool="point"])' : '[data-tool]',
  )) {
    const active = button.dataset.tool === tool;
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('part', `tool tool-${button.dataset.tool}${active ? ' tool-on' : ''}`);
    if (own) continue;
    button.style.background = active
      ? 'var(--pb-color-main,#f4f4f5)'
      : 'var(--pb-color-surface,#17181c)';
    button.style.borderColor = active
      ? 'var(--pb-color-main,#f4f4f5)'
      : 'var(--pb-color-border,#33363d)';
    button.style.color = active
      ? 'var(--pb-color-on-main,#17181c)'
      : 'var(--pb-color-text,#f4f4f5)';
  }
}

function makeButton(
  item: (typeof buttons)[number],
  element: HTMLElement,
  opts: ToolsOptions,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.title = item.name;
  button.setAttribute('aria-label', item.name);
  if (!opts.parent) button.style.cssText = buttonStyle;
  button.append(icon(item.path, item.filled));
  if (item.tool) {
    const tool = item.tool;
    button.dataset.tool = tool;
    button.onclick = () => {
      press(element, tool, !!opts.parent);
      opts.onTool(tool);
    };
  } else {
    button.dataset.act = item.act;
    button.setAttribute('part', `tool tool-${item.act}`);
    button.onclick = () => {
      if (item.act === 'undo') opts.onUndo();
      else opts.onClear();
    };
  }
  element.append(button);
  return button;
}

export function mountTools(root: ShadowRoot, opts: ToolsOptions): Tools {
  const { parent } = opts;
  const element = parent ?? document.createElement('div');
  if (!parent) {
    element.setAttribute('role', 'toolbar');
    element.setAttribute('aria-label', 'Drawing tools');
    element.dataset.role = 'tools';
    element.style.cssText = `position:fixed;bottom:14px;display:flex;gap:6px;pointer-events:auto;${opts.side}:calc(var(--pb-size-launcher,36px) + 24px)`;
  }
  const own = buttons.map((item, index) => {
    const button = makeButton(item, element, opts);
    if (parent) button.style.setProperty('--pb-i', String(index + 1));
    return button;
  });
  press(element, opts.tool, !!parent);
  if (!parent) root.append(element);
  const setCount = (count: number): void => {
    for (const button of own.filter((one) => one.dataset.act)) {
      button.disabled = count === 0;
      if (parent) continue;
      button.style.opacity = count === 0 ? '.45' : '1';
      button.style.cursor = count === 0 ? 'default' : 'pointer';
    }
  };
  setCount(0);
  return {
    element,
    setCount,
    destroy: () => (parent ? own.forEach((button) => button.remove()) : element.remove()),
  };
}
