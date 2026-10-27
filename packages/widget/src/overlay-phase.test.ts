// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLASS } from './styles';
import { armWidget } from './test-arm';
import type { Overlay } from './overlay';
import { createOverlay } from './overlay';

function stubRect(el: Element, left: number, top: number): void {
  el.getBoundingClientRect = () =>
    ({
      left,
      top,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: left,
      y: top,
      toJSON() {},
    }) as DOMRect;
}

let overlays: Overlay[] = [];

afterEach(() => {
  overlays.forEach((overlay) => overlay.destroy());
  overlays = [];
  document.body.innerHTML = '';
});

function setup() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  const overlay = createOverlay({
    doc: document,
    root,
    host,
    selectorOf: (el: Element) => el.tagName.toLowerCase(),
    onSubmit: vi.fn(),
  });
  overlays.push(overlay);
  return { host, root, overlay };
}

function armViaLauncher(root: ShadowRoot): void {
  armWidget(root);
}

function pinTarget(left: number, top: number, clientX: number, clientY: number): void {
  const target = document.createElement('div');
  document.body.appendChild(target);
  stubRect(target, left, top);
  target.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, clientX, clientY }),
  );
}

function textareaOf(root: ShadowRoot): HTMLTextAreaElement {
  return root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
}

function sendComment(root: ShadowRoot, text: string): void {
  const textarea = textareaOf(root);
  textarea.value = text;
  textarea.dispatchEvent(new Event('input'));
  textarea.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
}

function pressEscape(target: EventTarget): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
}

describe('data-passback-phase on the host', () => {
  it('marks the host idle as soon as the overlay is created', () => {
    const { host } = setup();
    expect(host.getAttribute('data-passback-phase')).toBe('idle');
  });

  it('marks the host armed from the launcher and idle again on Escape', () => {
    const { host, root } = setup();
    armViaLauncher(root);
    expect(host.getAttribute('data-passback-phase')).toBe('armed');

    pressEscape(document);
    expect(host.getAttribute('data-passback-phase')).toBe('idle');
  });

  it('marks the host composing when a point is pinned', () => {
    const { host, root } = setup();
    armViaLauncher(root);
    pinTarget(10, 20, 15, 27);
    expect(host.getAttribute('data-passback-phase')).toBe('composing');
  });

  it('marks the host idle when the comment box is cancelled', () => {
    const { host, root } = setup();
    armViaLauncher(root);
    pinTarget(10, 20, 15, 27);
    pressEscape(textareaOf(root));
    expect(host.getAttribute('data-passback-phase')).toBe('idle');
  });

  it('marks the host sending on Send and idle once the mark is acked', () => {
    const { host, root, overlay } = setup();
    armViaLauncher(root);
    pinTarget(10, 20, 15, 27);
    sendComment(root, 'hello');
    expect(host.getAttribute('data-passback-phase')).toBe('sending');

    overlay.acked('inbox-123', false);
    expect(host.getAttribute('data-passback-phase')).toBe('idle');
  });

  it('keeps the host at sending while a failed send offers Retry', () => {
    const { host, root, overlay } = setup();
    armViaLauncher(root);
    pinTarget(10, 20, 15, 27);
    sendComment(root, 'hello');

    overlay.failed('network error');
    expect(root.querySelector<HTMLButtonElement>(`.${CLASS.send}`)!.textContent).toBe('Retry');
    expect(host.getAttribute('data-passback-phase')).toBe('sending');

    root.querySelector<HTMLButtonElement>(`.${CLASS.send}`)!.click();
    expect(host.getAttribute('data-passback-phase')).toBe('sending');

    overlay.acked('inbox-123', false);
    expect(host.getAttribute('data-passback-phase')).toBe('idle');
  });

  it('keeps the attribute equal to phase() through a whole pin, send and ack', () => {
    const { host, root, overlay } = setup();
    const seen: (string | null)[] = [];
    const check = () => {
      expect(host.getAttribute('data-passback-phase')).toBe(overlay.phase());
      seen.push(host.getAttribute('data-passback-phase'));
    };
    check();
    armViaLauncher(root);
    check();
    pinTarget(10, 20, 15, 27);
    check();
    sendComment(root, 'hello');
    check();
    overlay.acked('inbox-123', false);
    check();
    expect(seen).toEqual(['idle', 'armed', 'composing', 'sending', 'idle']);
  });
});
