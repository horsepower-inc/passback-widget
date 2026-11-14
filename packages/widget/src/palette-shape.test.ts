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

function open() {
  const drawing = { toggle: vi.fn(), cancel: vi.fn() };
  scope.__passback = { fx: { addons: [palette] } };
  const host = document.body.appendChild(document.createElement('div'));
  const root = host.attachShadow({ mode: 'open' });
  overlays.push(
    createOverlay({
      doc: document,
      root,
      host,
      selectorOf: (el) => el.tagName.toLowerCase(),
      onSubmit: vi.fn(),
      drawing,
    }),
  );
  const bar = root.querySelector<HTMLElement>('.pb-palette')!;
  const box = bar.appendChild(document.createElement('button'));
  box.dataset.tool = 'box';
  box.setAttribute('aria-pressed', 'false');
  const point = bar.querySelector<HTMLElement>('[data-tool="point"]')!;
  root.querySelector<HTMLButtonElement>(`.${CLASS.launcher}`)!.click();
  return { bar, box, point, drawing };
}

describe('palette shape while armed', () => {
  it('R2 choosing a shape while armed turns drawing on before any press', () => {
    const { bar, box, drawing } = open();
    expect(drawing.toggle).not.toHaveBeenCalled();
    box.click();
    expect(drawing.toggle).toHaveBeenCalledExactlyOnceWith(true);
    expect(bar.dataset.pending).toBe('');
    expect(bar.dataset.shape).toBe('box');
  });

  it('R2 Point after a shape turns drawing off again while armed', () => {
    const { bar, box, point, drawing } = open();
    box.click();
    point.click();
    expect(drawing.toggle).toHaveBeenLastCalledWith(false);
    expect(bar.dataset.pending).toBeUndefined();
  });

  it('R2 Escape while a shape waits closes the drawing layer', () => {
    const { bar, box, drawing } = open();
    box.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(drawing.cancel).toHaveBeenCalledOnce();
    expect(bar.dataset.pending).toBeUndefined();
  });
});
