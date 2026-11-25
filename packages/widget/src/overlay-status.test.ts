// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLASS } from './styles';
import { armWidget as armViaLauncher } from './test-arm';
import type { Overlay, OverlayOptions, SubmitDetail } from './overlay';
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

function setup(
  overrides: {
    onSubmit?(detail: SubmitDetail): void;
    selectorOf?(el: Element): string;
    guard?: OverlayOptions['guard'];
  } = {},
) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  const onSubmit = overrides.onSubmit ?? vi.fn();
  const selectorOf = overrides.selectorOf ?? ((el: Element) => el.tagName.toLowerCase());
  const overlay = createOverlay({
    doc: document,
    root,
    host,
    selectorOf,
    onSubmit,
    guard: overrides.guard,
  });
  overlays.push(overlay);
  return { host, root, overlay, onSubmit, selectorOf };
}

function pinTarget(left: number, top: number, clientX: number, clientY: number): Element {
  const target = document.createElement('div');
  document.body.appendChild(target);
  stubRect(target, left, top);
  target.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, clientX, clientY }),
  );
  return target;
}

function typeInto(textarea: HTMLTextAreaElement, text: string): void {
  textarea.value = text;
  textarea.dispatchEvent(new Event('input'));
}

function pressEnter(textarea: HTMLTextAreaElement): void {
  textarea.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
}

function pinAndAck(
  root: ShadowRoot,
  overlay: Overlay,
  place: [number, number, number, number],
  id: string,
): void {
  armViaLauncher(root);
  pinTarget(...place);
  const textarea = root.querySelectorAll<HTMLTextAreaElement>(`.${CLASS.input}`);
  const input = textarea[textarea.length - 1]!;
  typeInto(input, 'a comment');
  pressEnter(input);
  overlay.acked(id, false);
}

function dots(root: ShadowRoot): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`.${CLASS.dot}`));
}

function bubbles(root: ShadowRoot): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`.${CLASS.bubble}`));
}

describe('Overlay.status', () => {
  it('status sets the dot state and shows the status in the bubble of the acked mark', () => {
    const { root, overlay } = setup();
    pinAndAck(root, overlay, [10, 20, 15, 27], 'inbox-1');

    const bubble = bubbles(root)[0]!;
    const before = bubble.textContent;

    overlay.status({ markId: 'inbox-1', state: 'running', message: 'building', prUrl: undefined });

    const dot = dots(root)[0]!;
    expect(dot.getAttribute('data-state')).toBe('running');
    expect(bubble.textContent).not.toBe(before);
  });

  it('status changes only the mark whose id matches', () => {
    const { root, overlay } = setup();
    pinAndAck(root, overlay, [10, 20, 15, 27], 'inbox-1');
    pinAndAck(root, overlay, [30, 40, 35, 47], 'inbox-2');

    const [firstBefore, secondBefore] = bubbles(root);
    const firstText = firstBefore!.textContent;
    const secondText = secondBefore!.textContent;

    overlay.status({ markId: 'inbox-2', state: 'done', message: undefined, prUrl: undefined });

    const [firstDot, secondDot] = dots(root);
    expect(firstDot!.getAttribute('data-state')).toBe('queued');
    expect(secondDot!.getAttribute('data-state')).toBe('done');

    const [firstBubble, secondBubble] = bubbles(root);
    expect(firstBubble!.getAttribute('data-mark-id')).toBe('inbox-1');
    expect(secondBubble!.getAttribute('data-mark-id')).toBe('inbox-2');
    expect(firstBubble!.textContent).toBe(firstText);
    expect(secondBubble!.textContent).not.toBe(secondText);
  });

  it('status ignores an unknown id and a mark that is not acked yet', () => {
    const { root, overlay } = setup();
    armViaLauncher(root);
    pinTarget(10, 20, 15, 27);
    const textarea = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
    typeInto(textarea, 'a comment');
    pressEnter(textarea);

    overlay.status({
      markId: 'not-acked-yet',
      state: 'running',
      message: undefined,
      prUrl: undefined,
    });

    const dot = dots(root)[0]!;
    expect(dot.getAttribute('data-state')).toBe('sending');
    const bubble = bubbles(root)[0]!;
    expect(bubble.getAttribute('data-state')).toBe('sending');

    overlay.acked('inbox-3', false);
    const ackedText = bubbles(root)[0]!.textContent;
    overlay.status({ markId: 'unknown-id', state: 'failed', message: undefined, prUrl: undefined });

    expect(dots(root)[0]!.getAttribute('data-state')).toBe('queued');
    expect(bubbles(root)[0]!.textContent).toBe(ackedText);
    expect(bubbles(root)[0]!.getAttribute('data-mark-id')).toBe('inbox-3');
  });
});
