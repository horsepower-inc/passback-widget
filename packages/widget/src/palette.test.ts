// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Overlay } from './overlay';
import { createOverlay } from './overlay';
import { palette } from './palette';
import { CLASS } from './styles';

const scope = globalThis as { __passback?: unknown };
let overlays: Overlay[] = [];

afterEach(() => {
  overlays.forEach((overlay) => overlay.destroy());
  overlays = [];
  delete scope.__passback;
  document.body.innerHTML = '';
});

const drawing = { toggle: vi.fn(), cancel: vi.fn() };

function open(registered = true) {
  if (registered) scope.__passback = { fx: { addons: [palette] } };
  const host = document.body.appendChild(document.createElement('div'));
  const root = host.attachShadow({ mode: 'open' });
  const overlay = createOverlay({
    doc: document,
    root,
    host,
    selectorOf: (el) => el.tagName.toLowerCase(),
    onSubmit: vi.fn(),
    drawing,
  });
  overlays.push(overlay);
  const bar = () => root.querySelector<HTMLElement>('.pb-palette');
  const press = () => root.querySelector<HTMLButtonElement>(`.${CLASS.launcher}`)!.click();
  const shape = (tool: string): HTMLButtonElement => {
    const button = document.createElement('button');
    button.dataset.tool = tool;
    button.setAttribute('aria-pressed', 'false');
    bar()!.append(button);
    return button;
  };
  const pin = (): void => {
    const target = document.body.appendChild(document.createElement('p'));
    target.click();
  };
  return { host, root, overlay, bar, press, shape, pin };
}

describe('palette', () => {
  it('R2 shows Point pressed beside the ball as soon as the ball arms, and nothing else', () => {
    const { root, bar, press } = open();
    expect(bar()?.hasAttribute('data-open')).toBe(false);
    press();
    expect(bar()?.hasAttribute('data-open')).toBe(true);
    expect(bar()?.getAttribute('role')).toBe('toolbar');
    expect(bar()?.getAttribute('aria-label')).toBe('Drawing tools');
    expect(bar()?.dataset.role).toBe('tools');
    expect(bar()?.dataset.corner).toBe('bottom-right');
    const buttons = root.querySelectorAll('.pb-palette button');
    expect(buttons).toHaveLength(1);
    const point = buttons[0]!;
    expect(point.getAttribute('aria-label')).toBe('Point');
    expect(point.getAttribute('title')).toBe('Point');
    expect(point.getAttribute('aria-pressed')).toBe('true');
    expect((point as HTMLElement).dataset.tool).toBe('point');
    expect(point.querySelectorAll('svg path')).toHaveLength(1);
  });

  it('R2 attaches when the collector chunk registers after the widget opened', () => {
    const { root, bar, press } = open(false);
    press();
    expect(bar()).toBeNull();
    scope.__passback = { fx: { addons: [palette] } };
    document.dispatchEvent(new Event('passback:fx'));
    expect(bar()?.hasAttribute('data-open')).toBe(true);
    expect(root.querySelectorAll('.pb-palette')).toHaveLength(1);
  });

  it('R2 pops the button out with a staggered delay and shows it in place under reduced motion', () => {
    const { root } = open();
    const css = root.querySelector('style[data-pb-palette-styles]')?.textContent ?? '';
    expect(css).toContain('var(--pb-i, 0) * 35ms');
    expect(css).toContain('cubic-bezier');
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[^}]*transition: none/);
  });

  it('R2b opens the tools 35 ms apart and closes them in reverse order', () => {
    const { root } = open();
    const css = root.querySelector('style[data-pb-palette-styles]')?.textContent ?? '';
    expect(css).toContain('transition-delay: calc(var(--pb-i, 0) * 35ms)');
    expect(css).toContain('calc((6 - var(--pb-i, 0)) * 35ms)');
    expect(css).not.toContain('50ms');
  });

  it('R2b turns the ball glyph as the tools open and keeps it still under reduced motion', () => {
    const { root } = open();
    const css = root.querySelector('style[data-pb-palette-styles]')?.textContent ?? '';
    expect(css).toContain('@keyframes pb-pal-turn');
    expect(css).toContain(".pb-launcher[aria-label='Passback: close'] svg");
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[^]*animation: none/);
  });

  it('R2 hides the palette on close and while sending', () => {
    const { host, bar, press } = open();
    press();
    expect(bar()?.hasAttribute('data-open')).toBe(true);
    press();
    expect(bar()?.hasAttribute('data-open')).toBe(false);
    press();
    expect(bar()?.hasAttribute('data-open')).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(bar()?.hasAttribute('data-open')).toBe(false);
    expect(host.getAttribute('data-pb-panel')).toBe('closed');
  });

  it('R2 removes the palette, its styles and its listeners with the overlay', () => {
    const { host, root, overlay, bar } = open();
    expect(bar()).not.toBeNull();
    const remove = vi.spyOn(host, 'removeEventListener');
    overlay.destroy();
    expect(root.querySelector('.pb-palette')).toBeNull();
    expect(root.querySelector('style[data-pb-palette-styles]')).toBeNull();
    expect(remove.mock.calls.map(([type]) => type)).toEqual(['passback:sync', 'passback:dispose']);
    host.dispatchEvent(new Event('passback:dispose'));
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('R2 enables the shape tools while armed and a click presses the chosen one', () => {
    const { bar, press, shape } = open();
    const arrow = shape('arrow');
    const box = shape('box');
    press();
    const point = bar()!.querySelector<HTMLElement>('[data-tool="point"]')!;
    expect(root(bar()!).querySelector('style[data-pb-palette-styles]')?.textContent).not.toContain(
      'not([data-on])',
    );
    expect(bar()?.hasAttribute('data-on')).toBe(false);
    expect(point.getAttribute('aria-pressed')).toBe('true');
    box.click();
    expect(bar()?.dataset.shape).toBe('box');
    expect(bar()?.dataset.pending).toBe('');
    expect(box.getAttribute('aria-pressed')).toBe('true');
    expect(arrow.getAttribute('aria-pressed')).toBe('false');
    expect(point.getAttribute('aria-pressed')).toBe('false');
    expect(drawing.toggle).not.toHaveBeenCalledWith(true);
  });

  it('R2 a shape chosen while armed starts drawing on the comment the next press opens', () => {
    const { bar, press, shape, pin } = open();
    const arrow = shape('arrow');
    press();
    arrow.click();
    pin();
    expect(bar()?.hasAttribute('data-on')).toBe(true);
    expect(bar()?.dataset.pending).toBeUndefined();
    expect(drawing.toggle).toHaveBeenLastCalledWith(true);
    expect(arrow.getAttribute('aria-pressed')).toBe('true');
  });

  it('R2 Point after a shape chosen while armed cancels the pending shape', () => {
    const { bar, press, shape, pin } = open();
    const arrow = shape('arrow');
    const point = bar()!.querySelector<HTMLElement>('[data-tool="point"]')!;
    press();
    drawing.toggle.mockClear();
    arrow.click();
    point.click();
    expect(bar()?.dataset.pending).toBeUndefined();
    expect(point.getAttribute('aria-pressed')).toBe('true');
    expect(arrow.getAttribute('aria-pressed')).toBe('false');
    pin();
    expect(drawing.toggle).not.toHaveBeenCalled();
    expect(arrow.getAttribute('aria-pressed')).toBe('false');
  });

  it('R2 a shape click starts drawing on the open comment and Point ends it', () => {
    const { host, bar, press, shape, pin } = open();
    const arrow = shape('box');
    const point = bar()!.querySelector<HTMLElement>('[data-tool="point"]')!;
    press();
    arrow.click();
    expect(drawing.toggle).not.toHaveBeenCalled();
    pin();
    arrow.click();
    expect(bar()?.dataset.shape).toBe('box');
    expect(drawing.toggle).toHaveBeenLastCalledWith(true);
    expect(bar()?.hasAttribute('data-open')).toBe(true);
    expect(point.getAttribute('aria-pressed')).toBe('false');
    expect(arrow.getAttribute('aria-pressed')).toBe('true');
    point.click();
    expect(drawing.toggle).toHaveBeenLastCalledWith(false);
    expect(point.getAttribute('aria-pressed')).toBe('true');
    expect(arrow.getAttribute('aria-pressed')).toBe('false');
    expect(host.getAttribute('data-pb-panel')).toBe('open');
  });

  it('R2 sets the pressed tool apart with full opacity and a tool-on part', () => {
    const { root, bar, press, shape } = open();
    const box = shape('box');
    press();
    const css = root.querySelector('style[data-pb-palette-styles]')?.textContent ?? '';
    const rules = [...css.matchAll(/([^{}\n]+)\{([^}]*)\}/g)].map(
      ([, selector, body]) => [selector!.trim(), body!] as const,
    );
    const idle = rules.findIndex(([selector]) =>
      selector.startsWith('.pb-palette[data-open] :is('),
    );
    const pressed = rules.findIndex(
      ([selector]) => selector === ".pb-palette[data-open] button[aria-pressed='true']",
    );
    expect(idle).toBeGreaterThanOrEqual(0);
    expect(pressed).toBeGreaterThan(idle);
    expect(rules[pressed]![1]).toContain('opacity: 1');
    expect(css).toContain(
      ".pb-palette button[aria-pressed='true'] { background: var(--pb-color-main);",
    );
    const point = bar()!.querySelector<HTMLElement>('[data-tool="point"]')!;
    expect(point.getAttribute('part')).toBe('tool tool-point tool-on');
    expect(box.getAttribute('part')).toBe('tool tool-box');
    box.click();
    expect(point.getAttribute('part')).toBe('tool tool-point');
    expect(box.getAttribute('part')).toBe('tool tool-box tool-on');
  });

  it('R2 never presses a disabled tool', () => {
    const { host, bar, press, shape } = open();
    const arrow = shape('arrow');
    press();
    arrow.click();
    expect(arrow.getAttribute('aria-pressed')).toBe('true');
    arrow.disabled = true;
    host.dispatchEvent(new Event('passback:sync'));
    expect(arrow.getAttribute('aria-pressed')).toBe('false');
    expect(arrow.getAttribute('part')).toBe('tool tool-arrow');
    expect(bar()!.querySelector('[data-tool="point"]')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('R2 a disabled tool is invisible while the palette is closed', () => {
    const { root, press } = open();
    press();
    const css = root.querySelector('style[data-pb-palette-styles]')?.textContent ?? '';
    const rules = [...css.matchAll(/([^{}\n]+)\{([^}]*)\}/g)].map(
      ([, selector, body]) => [selector!.trim(), body!] as const,
    );
    const disabled = rules.filter(([selector]) => selector.endsWith(':disabled'));
    disabled
      .filter(([, body]) => body.includes('opacity'))
      .forEach(([selector]) => expect(selector).toContain('[data-open]'));
  });

  it('R2 flushes the closed style before the first open so the buttons have a start state', () => {
    const reads: boolean[] = [];
    const proto = HTMLElement.prototype;
    Object.defineProperty(proto, 'offsetWidth', {
      configurable: true,
      get(this: HTMLElement) {
        if (this.classList.contains('pb-palette')) reads.push(this.hasAttribute('data-open'));
        return 0;
      },
    });
    try {
      const { bar, press } = open();
      press();
      expect(bar()?.hasAttribute('data-open')).toBe(true);
      expect(reads[0]).toBe(false);
    } finally {
      delete (proto as { offsetWidth?: number }).offsetWidth;
    }
  });

  it('R2 starts a tool appended while the palette is open from the closed state', async () => {
    const { bar, press } = open();
    press();
    const seen: boolean[] = [];
    const button = document.createElement('button');
    button.dataset.tool = 'box';
    Object.defineProperty(button, 'offsetWidth', {
      configurable: true,
      get: () => {
        seen.push(button.hasAttribute('data-enter'));
        return 0;
      },
    });
    bar()!.append(button);
    await Promise.resolve();
    expect(seen).toEqual([true]);
    expect(button.hasAttribute('data-enter')).toBe(false);
  });

  it('R2 asks for the shape tools when the panel opens', () => {
    const { host, press } = open();
    const asked = vi.fn();
    host.addEventListener('passback:preload', asked);
    expect(asked).not.toHaveBeenCalled();
    press();
    expect(asked).toHaveBeenCalled();
  });
});

const root = (element: HTMLElement): ShadowRoot => element.getRootNode() as ShadowRoot;
