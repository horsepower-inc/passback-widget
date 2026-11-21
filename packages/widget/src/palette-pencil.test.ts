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

function open() {
  scope.__passback = { fx: { addons: [palette] } };
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
  return root;
}

describe('palette pencil', () => {
  it('R2 the pencil of the bubble a chosen shape pins is pressed', () => {
    const root = open();
    const box = document.createElement('button');
    box.dataset.tool = 'box';
    box.setAttribute('aria-pressed', 'false');
    root.querySelector('.pb-palette')!.append(box);
    root.querySelector<HTMLButtonElement>(`.${CLASS.launcher}`)!.click();
    box.click();
    document.body.appendChild(document.createElement('p')).click();
    expect(drawing.toggle).toHaveBeenLastCalledWith(true);
    const pencil = root.querySelector('[data-role="draw"]');
    expect(pencil?.getAttribute('aria-pressed')).toBe('true');
  });
});
