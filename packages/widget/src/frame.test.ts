// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createOverlay, type Overlay, type OverlayOptions } from './overlay';
import { CLASS } from './styles';

let overlays: Overlay[] = [];
afterEach(() => {
  overlays.forEach((overlay) => overlay.destroy());
  overlays = [];
  document.documentElement.querySelectorAll('[data-pb-frame]').forEach((el) => el.remove());
  document.body.innerHTML = '';
});

function setup(extra: Partial<OverlayOptions> = {}): { root: ShadowRoot; overlay: Overlay } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  const overlay = createOverlay({
    doc: document,
    root,
    host,
    selectorOf: () => 'div',
    onSubmit: () => {},
    ...extra,
  });
  overlays.push(overlay);
  return { root, overlay };
}

function frames(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-pb-frame]')];
}

function pin(): void {
  const target = document.createElement('div');
  document.body.appendChild(target);
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
}

function write(root: ShadowRoot, text: string): void {
  pin();
  const input = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
  input.value = text;
  input.dispatchEvent(new Event('input'));
}

function send(root: ShadowRoot): void {
  root
    .querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

function escape(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

describe('frame', () => {
  it('shows a 4 px frame in the main colour while the widget is armed', () => {
    const { root, overlay } = setup();
    expect(frames()).toHaveLength(0);
    overlay.arm();
    const [frame] = frames();
    expect(frames()).toHaveLength(1);
    expect(frame!.parentElement).toBe(document.documentElement);
    expect(root.contains(frame!)).toBe(false);
    const css = frame!.style.cssText;
    expect(css).toContain('position: fixed');
    expect(css).toMatch(/inset: 0(px)?/);
    expect(css).toContain('border: 4px solid');
    expect(css).toContain('#17181c');
    expect(css).toContain('transition: none');
  });

  it('the frame never takes pointer input', () => {
    setup().overlay.arm();
    expect(frames()[0]!.style.pointerEvents).toBe('none');
  });

  it('removes the frame when the widget leaves and when it is destroyed', () => {
    const drawing = { toggle: () => {}, cancel: () => {} };
    const { root, overlay } = setup({ drawing });
    overlay.arm();
    const frame = frames()[0]!;
    // Armed → composing → drawing → composing keeps the one frame.
    pin();
    expect(overlay.phase()).toBe('composing');
    expect(frames()).toEqual([frame]);
    overlay.setDrawing(true);
    expect(frames()).toEqual([frame]);
    overlay.setDrawing(false);
    expect(frames()).toEqual([frame]);
    // Sending leaves the frame states, and the acknowledgement leaves the widget idle.
    send(root);
    expect(overlay.phase()).toBe('sending');
    expect(frames()).toHaveLength(0);
    overlay.acked('m1', false);
    expect(overlay.phase()).toBe('idle');
    expect(frames()).toHaveLength(0);
    // Escape while armed and while composing.
    overlay.arm();
    expect(frames()).toHaveLength(1);
    escape();
    expect(frames()).toHaveLength(0);
    overlay.arm();
    pin();
    escape();
    expect(frames()).toHaveLength(0);
    // A full list parks its draft on Escape; reopening restores the composer and the frame.
    overlay.arm();
    for (let i = 0; i < 20; i += 1) {
      write(root, `c${i}`);
      root.querySelector<HTMLElement>('[data-role="add-more"]')!.click();
    }
    write(root, 'overflow');
    escape();
    expect(overlay.phase()).toBe('composing');
    expect(frames()).toHaveLength(0);
    overlay.arm();
    expect(overlay.phase()).toBe('composing');
    expect(frames()).toHaveLength(1);
    overlay.destroy();
    overlay.destroy();
    expect(frames()).toHaveLength(0);
  });
});
