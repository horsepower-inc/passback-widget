// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Overlay, OverlayOptions } from './overlay';
import { createOverlay } from './overlay';
import { CLASS } from './styles';

let overlays: Overlay[] = [];
afterEach(() => {
  overlays.forEach((overlay) => overlay.destroy());
  overlays = [];
  document.body.innerHTML = '';
});

function setup(drawing?: OverlayOptions['drawing']) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  const onSubmit = vi.fn();
  const overlay = createOverlay({
    doc: document,
    root,
    host,
    selectorOf: () => 'div',
    onSubmit,
    drawing,
  });
  overlays.push(overlay);
  return { root, overlay, onSubmit };
}

function compose(overlay: Overlay, root: ShadowRoot): HTMLTextAreaElement {
  overlay.arm();
  const target = document.createElement('div');
  document.body.appendChild(target);
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  return root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
}

function pencil(root: ShadowRoot): HTMLButtonElement | null {
  return root.querySelector('[data-role="draw"]');
}

function send(input: HTMLTextAreaElement): void {
  input.value = 'a comment';
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

function fakeDrawing() {
  return { toggle: vi.fn(), cancel: vi.fn() };
}

describe('Overlay drawing', () => {
  it('gives the comment box no pencil when no drawing option is passed', () => {
    const { root, overlay } = setup();
    compose(overlay, root);
    expect(pencil(root)).toBeNull();
    overlay.setDrawing(true);
  });

  it('shows the pencil and forwards its presses to drawing.toggle', () => {
    const drawing = fakeDrawing();
    const { root, overlay } = setup(drawing);
    compose(overlay, root);
    pencil(root)!.click();
    pencil(root)!.click();
    expect(drawing.toggle.mock.calls).toEqual([[true], [false]]);
  });

  it('turns drawing off and keeps the session when the comment box is cancelled', () => {
    const drawing = fakeDrawing();
    const { root, overlay } = setup(drawing);
    const input = compose(overlay, root);
    pencil(root)!.click();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(drawing.cancel).not.toHaveBeenCalled();
    expect(drawing.toggle.mock.lastCall).toEqual([false]);
    expect(root.querySelector(`.${CLASS.bubble}`)).toBeNull();
    expect(overlay.phase()).toBe('idle');
  });

  it('ends drawing when the overlay is destroyed while a comment is being written', () => {
    const drawing = fakeDrawing();
    const { root, overlay } = setup(drawing);
    compose(overlay, root);
    pencil(root)!.click();
    overlay.destroy();
    overlays = [];
    expect(drawing.cancel).toHaveBeenCalledTimes(1);
    expect(root.querySelector(`.${CLASS.bubble}`)).toBeNull();
  });

  it('does not end drawing when the comment is sent', () => {
    const drawing = fakeDrawing();
    const { root, overlay, onSubmit } = setup(drawing);
    send(compose(overlay, root));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    overlay.failed('offline');
    root.querySelector<HTMLButtonElement>(`.${CLASS.send}`)!.click();
    expect(onSubmit).toHaveBeenCalledTimes(2);
    overlay.acked('mark-1', false);
    overlay.destroy();
    overlays = [];
    expect(drawing.cancel).not.toHaveBeenCalled();
    expect(drawing.toggle).not.toHaveBeenCalled();
  });

  it('acked shows the note under the sent line', () => {
    const { root, overlay } = setup();
    send(compose(overlay, root));
    overlay.acked('mark-1', false, 'Screenshot not attached');
    const notes = root.querySelectorAll(`.${CLASS.note}`);
    expect(Array.from(notes, (note) => note.textContent)).toEqual([
      'Sent. Waiting for the agent.',
      'Screenshot not attached',
    ]);
  });

  it('setDrawing changes the pencil without calling drawing.toggle', () => {
    const drawing = fakeDrawing();
    const { root, overlay } = setup(drawing);
    overlay.setDrawing(true);
    const input = compose(overlay, root);
    expect(pencil(root)!.getAttribute('aria-pressed')).toBe('false');
    overlay.setDrawing(true);
    expect(pencil(root)!.getAttribute('aria-pressed')).toBe('true');
    overlay.setDrawing(false);
    expect(pencil(root)!.getAttribute('aria-pressed')).toBe('false');
    send(input);
    overlay.setDrawing(true);
    expect(pencil(root)!.getAttribute('aria-pressed')).toBe('false');
    expect(drawing.toggle).not.toHaveBeenCalled();
  });
});
