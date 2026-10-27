// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBoundary } from './boundary';
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

describe('createOverlay: teardown and guards', () => {
  it('cleans up every mark, not just the latest, on destroy', () => {
    const { root, overlay } = setup();
    armViaLauncher(root);
    pinTarget(10, 20, 15, 27);
    const firstInput = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
    typeInto(firstInput, 'first');
    pressEnter(firstInput);
    overlay.acked('inbox-1', false);

    armViaLauncher(root);
    pinTarget(30, 40, 35, 47);
    const secondInput = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
    typeInto(secondInput, 'second');
    pressEnter(secondInput);
    overlay.acked('inbox-2', false);

    expect(root.querySelectorAll(`.${CLASS.dot}`).length).toBe(2);
    expect(root.querySelectorAll(`.${CLASS.bubble}`).length).toBe(2);

    overlay.destroy();

    expect(root.querySelectorAll(`.${CLASS.dot}`).length).toBe(0);
    expect(root.querySelectorAll(`.${CLASS.bubble}`).length).toBe(0);
  });

  it('ignores extra retry clicks while a retry is already in flight', () => {
    const onSubmit = vi.fn();
    const { root, overlay } = setup({ onSubmit });
    armViaLauncher(root);
    pinTarget(10, 20, 15, 27);
    const textarea = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
    typeInto(textarea, 'hello');
    pressEnter(textarea);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    overlay.failed('network error');
    const retry = root.querySelector<HTMLButtonElement>(`.${CLASS.send}`)!;
    retry.click();
    retry.click();
    retry.click();

    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('trips the guard instead of throwing when a callback throws', () => {
    const onTrip = vi.fn();
    const boundary = createBoundary(onTrip);
    const selectorOf = () => {
      throw new Error('boom');
    };
    const { root } = setup({ selectorOf, guard: boundary.guard });
    armViaLauncher(root);
    pinTarget(10, 20, 15, 27);
    const textarea = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
    typeInto(textarea, 'hello');

    expect(() => pressEnter(textarea)).not.toThrow();
    expect(boundary.tripped()).toBe(true);
    expect(onTrip).toHaveBeenCalledOnce();
  });

  it('removes everything on destroy', () => {
    const { root, overlay } = setup();
    armViaLauncher(root);
    pinTarget(10, 20, 15, 27);

    overlay.destroy();

    expect(root.querySelector(`.${CLASS.launcher}`)).toBeNull();
    expect(root.querySelector(`.${CLASS.outline}`)).toBeNull();
    expect(root.querySelector(`.${CLASS.dot}`)).toBeNull();
    expect(root.querySelector(`.${CLASS.bubble}`)).toBeNull();
    expect(document.documentElement.style.cursor).toBe('');
  });
});
