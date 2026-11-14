// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Overlay } from './overlay';
import { createOverlay } from './overlay';
import { outlineLabel } from './outline-label';
import { CLASS } from './styles';

const scope = globalThis as { __passback?: unknown };
let overlays: Overlay[] = [];

afterEach(() => {
  overlays.forEach((overlay) => overlay.destroy());
  overlays = [];
  delete scope.__passback;
  document.body.innerHTML = '';
});

function open(registered = true) {
  if (registered) scope.__passback = { fx: { addons: [outlineLabel] } };
  const host = document.body.appendChild(document.createElement('div'));
  const root = host.attachShadow({ mode: 'open' });
  const overlay = createOverlay({
    doc: document,
    root,
    host,
    selectorOf: (el) => el.tagName.toLowerCase(),
    onSubmit: vi.fn(),
    drawing: { toggle: vi.fn(), cancel: vi.fn() },
  });
  overlays.push(overlay);
  const target = document.body.appendChild(document.createElement('button'));
  target.id = 'buy';
  const label = () => root.querySelector<HTMLElement>('.pb-outline-label');
  const press = () => root.querySelector<HTMLButtonElement>(`.${CLASS.launcher}`)!.click();
  const hover = (el: Element | null) =>
    host.dispatchEvent(new CustomEvent('passback:hover', { detail: el }));
  return { host, root, target, label, press, hover };
}

describe('outline label', () => {
  it('shows the label of the hovered element on its outline and gives it no pointer events', () => {
    const { target, label, press, hover, root } = open();
    press();
    hover(target);
    expect(label()?.hidden).toBe(false);
    expect(label()?.textContent).toBe('button#buy');
    expect(label()?.getAttribute('part')).toBe('outline-label');
    expect(root.querySelector('[data-pb-outline-label-styles]')?.textContent).toContain(
      'pointer-events: none',
    );
  });

  it('hides the label while composing, drawing and on a null hover', () => {
    const { target, label, press, hover, host } = open();
    press();
    hover(target);
    hover(null);
    expect(label()?.hidden).toBe(true);
    hover(target);
    expect(label()?.hidden).toBe(false);
    target.click();
    host.dispatchEvent(new Event('passback:sync'));
    expect(label()?.hidden).toBe(true);
    hover(target);
    expect(label()?.hidden).toBe(true);
  });

  it('draws no label before the collector chunk has registered the add-on', () => {
    const { target, label, press, hover } = open(false);
    press();
    hover(target);
    expect(label()).toBeNull();
  });

  it('puts the label below the outline when there is no room above', () => {
    const { target, label, press, hover } = open();
    press();
    target.getBoundingClientRect = () => ({ left: 10, top: 4, bottom: 30, right: 50 }) as DOMRect;
    hover(target);
    expect(label()?.dataset.side).toBe('below');
    expect(label()?.style.top).toBe('30px');
    target.getBoundingClientRect = () =>
      ({ left: 10, top: 100, bottom: 130, right: 50 }) as DOMRect;
    hover(target);
    expect(label()?.dataset.side).toBe('above');
  });
});
