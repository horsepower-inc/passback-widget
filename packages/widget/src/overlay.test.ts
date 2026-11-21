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

function launcherEl(root: ShadowRoot): HTMLButtonElement {
  return root.querySelector<HTMLButtonElement>(`.${CLASS.launcher}`)!;
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

describe('createOverlay', () => {
  it('starts idle with the launcher visible', () => {
    const { root, overlay } = setup();
    expect(overlay.phase()).toBe('idle');
    expect(launcherEl(root).hasAttribute('hidden')).toBe(false);
  });

  it('arms from the launcher and from the hotkey', () => {
    const { root, overlay } = setup();
    armViaLauncher(root);
    expect(overlay.phase()).toBe('armed');
    expect(launcherEl(root).hasAttribute('hidden')).toBe(false);
    expect(launcherEl(root).getAttribute('aria-label')).toBe('Passback: close');

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(overlay.phase()).toBe('idle');

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        altKey: true,
        shiftKey: true,
        code: 'KeyR',
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(overlay.phase()).toBe('armed');
  });

  it('returns to idle on Escape while armed', () => {
    const { root, overlay } = setup();
    armViaLauncher(root);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );

    expect(overlay.phase()).toBe('idle');
    expect(launcherEl(root).hasAttribute('hidden')).toBe(false);
    expect(root.querySelector(`.${CLASS.outline}`)).toBeNull();
  });

  it('pins a clicked element and opens the bubble at the point', () => {
    const { root, overlay } = setup();
    armViaLauncher(root);

    pinTarget(10, 20, 15, 27);

    expect(overlay.phase()).toBe('composing');
    const dotEl = root.querySelector<HTMLElement>(`.${CLASS.dot}`)!;
    expect(dotEl.style.left).toBe('15px');
    expect(dotEl.style.top).toBe('27px');
    const bubbleEl = root.querySelector<HTMLElement>(`.${CLASS.bubble}`)!;
    expect(bubbleEl.style.left).toMatch(/^calc\(15px \+ var\(--pb-(space-)?gap\)\)$/);
    expect(bubbleEl.style.top).toMatch(/^calc\(27px \+ var\(--pb-(space-)?gap\)\)$/);
  });

  it('never lets the pin click reach a page click handler', () => {
    const { root } = setup();
    armViaLauncher(root);
    const target = document.createElement('div');
    document.body.appendChild(target);
    stubRect(target, 10, 20);
    const pageListener = vi.fn();
    target.addEventListener('click', pageListener);

    target.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: 15,
        clientY: 27,
      }),
    );

    expect(pageListener).not.toHaveBeenCalled();
  });

  it('removes the dot on Escape while composing', () => {
    const { root, overlay } = setup();
    armViaLauncher(root);
    pinTarget(10, 20, 15, 27);

    const textarea = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );

    expect(overlay.phase()).toBe('idle');
    expect(root.querySelector(`.${CLASS.dot}`)).toBeNull();
    expect(root.querySelector(`.${CLASS.bubble}`)).toBeNull();
    expect(launcherEl(root).hasAttribute('hidden')).toBe(false);
  });

  it('submits the comment, selector and offset once on Enter', () => {
    const onSubmit = vi.fn();
    const selectorOf = vi.fn(() => '#target');
    const { root, overlay } = setup({ onSubmit, selectorOf });
    armViaLauncher(root);
    const target = pinTarget(10, 20, 15, 27);

    const textarea = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
    typeInto(textarea, 'hello there');
    pressEnter(textarea);

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      comment: 'hello there',
      selector: '#target',
      offset: { x: 5, y: 7 },
      element: target,
    });
    expect(overlay.phase()).toBe('sending');
    const bubbleEl = root.querySelector<HTMLElement>(`.${CLASS.bubble}`)!;
    expect(bubbleEl.getAttribute('data-state')).toBe('sending');
  });

  it('shows the inbox id and keeps a queued dot when acked', () => {
    const { root, overlay } = setup();
    armViaLauncher(root);
    pinTarget(10, 20, 15, 27);
    const textarea = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
    typeInto(textarea, 'hello');
    pressEnter(textarea);

    overlay.acked('inbox-123', false);

    const bubbleEl = root.querySelector(`.${CLASS.bubble}`)!;
    expect(bubbleEl.getAttribute('data-mark-id')).toBe('inbox-123');
    const dotEl = root.querySelector<HTMLElement>(`.${CLASS.dot}`)!;
    expect(dotEl.getAttribute('data-state')).toBe('queued');
    expect(overlay.phase()).toBe('idle');
  });

  it('retries the same submission after a failure', () => {
    const onSubmit = vi.fn();
    const { root, overlay } = setup({ onSubmit });
    armViaLauncher(root);
    pinTarget(10, 20, 15, 27);
    const textarea = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
    typeInto(textarea, 'hello');
    pressEnter(textarea);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    overlay.failed('network error');
    const bubbleEl = root.querySelector(`.${CLASS.bubble}`)!;
    expect(bubbleEl.textContent).toContain('network error');
    const retry = root.querySelector<HTMLButtonElement>(`.${CLASS.send}`)!;
    expect(retry.textContent).toBe('Retry');
    retry.click();

    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[0]![0]).toEqual(onSubmit.mock.calls[1]![0]);
  });

  it('shows the sending pin while the comment is being sent', () => {
    const { root } = setup();
    armViaLauncher(root);
    pinTarget(10, 20, 15, 27);
    const textarea = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
    typeInto(textarea, 'hello');
    pressEnter(textarea);

    const dotEl = root.querySelector<HTMLElement>(`.${CLASS.dot}`)!;
    expect(dotEl.getAttribute('data-state')).toBe('sending');
  });

  it('shows the failed pin when the send fails', () => {
    const { root, overlay } = setup();
    armViaLauncher(root);
    pinTarget(10, 20, 15, 27);
    const textarea = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
    typeInto(textarea, 'hello');
    pressEnter(textarea);

    overlay.failed('network error');

    const dotEl = root.querySelector<HTMLElement>(`.${CLASS.dot}`)!;
    expect(dotEl.getAttribute('data-state')).toBe('failed');
  });

  it('goes back to the sending pin on Retry and to the waiting pin once acked', () => {
    const { root, overlay } = setup();
    armViaLauncher(root);
    pinTarget(10, 20, 15, 27);
    const textarea = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
    typeInto(textarea, 'hello');
    pressEnter(textarea);
    overlay.failed('network error');

    root.querySelector<HTMLButtonElement>(`.${CLASS.send}`)!.click();
    const dotEl = root.querySelector<HTMLElement>(`.${CLASS.dot}`)!;
    expect(dotEl.getAttribute('data-state')).toBe('sending');

    overlay.acked('inbox-123', false);
    expect(dotEl.getAttribute('data-state')).toBe('queued');
  });
});
