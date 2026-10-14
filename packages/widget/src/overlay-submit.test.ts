// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolveTarget } from '@passback/collectors';
import { CLASS } from './styles';
import { armWidget } from './test-arm';
import { createOverlay, type Overlay } from './overlay';

// Settled promises still settle on a microtask: Send's immediate state is visible before flush().
const TARGET: ResolveTarget = { selectors: [], tag: 'div', text: '' };
const now = () => Promise.resolve();
const offline = () => Promise.reject(new Error('collectors offline'));
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
let overlays: Overlay[] = [];

afterEach(() => {
  overlays.forEach((overlay) => overlay.destroy());
  overlays = [];
  document.body.innerHTML = '';
});

function setup(ready?: () => Promise<unknown>) {
  const host = document.body.appendChild(document.createElement('div'));
  const root = host.attachShadow({ mode: 'open' });
  const onSubmit = vi.fn();
  const selectorOf = vi.fn((el: Element) => el.tagName.toLowerCase());
  const targetOf = vi.fn(() => TARGET);
  const opts = { doc: document, root, host, onSubmit, selectorOf, targetOf, ready };
  const overlay = createOverlay(opts);
  overlays.push(overlay);
  const target = document.body.appendChild(document.createElement('div'));
  target.getBoundingClientRect = () => ({ left: 10, top: 20 }) as DOMRect;
  armWidget(root);
  const click = { bubbles: true, cancelable: true, composed: true, clientX: 15, clientY: 27 };
  target.dispatchEvent(new MouseEvent('click', click));
  const textarea = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
  textarea.value = 'hello';
  textarea.dispatchEvent(new Event('input'));
  textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
  const dot = () => root.querySelector(`.${CLASS.dot}`)!.getAttribute('data-state');
  const sent = { comment: 'hello', selector: 'div', offset: { x: 5, y: 7 }, element: target };
  return { host, root, overlay, onSubmit, selectorOf, targetOf, target, dot, sent };
}

describe('overlay submission', () => {
  it('without ready sends synchronously with selector and target', () => {
    const { onSubmit, targetOf, target, sent } = setup();
    expect(onSubmit).toHaveBeenCalledWith(sent);
    expect(targetOf).toHaveBeenCalledWith(target);
  });

  it('with ready shows sending at once and calls selectorOf and onSubmit only after ready resolves', async () => {
    const { host, root, onSubmit, selectorOf, dot, sent } = setup(now);
    expect(host.getAttribute('data-passback-phase')).toBe('sending');
    expect(dot()).toBe('sending');
    expect(root.querySelector(`.${CLASS.bubble}`)!.getAttribute('data-state')).toBe('sending');
    expect(selectorOf).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    await flush();
    expect(onSubmit).toHaveBeenCalledWith(sent);
  });

  it('with ready rejecting shows the error with Retry and calls neither selectorOf nor onSubmit', async () => {
    const { root, onSubmit, selectorOf, targetOf, dot } = setup(offline);
    await flush();
    expect(root.querySelector(`.${CLASS.bubble}`)!.textContent).toContain('collectors offline');
    expect(root.querySelector(`.${CLASS.send}`)!.textContent).toBe('Retry');
    expect(dot()).toBe('failed');
    expect(selectorOf).not.toHaveBeenCalled();
    expect(targetOf).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Retry after a rejected ready waits for ready again and then submits', async () => {
    const ready = vi.fn<() => Promise<unknown>>(offline);
    const { root, onSubmit, dot, sent } = setup(ready);
    await flush();
    ready.mockImplementationOnce(now);
    root.querySelector<HTMLButtonElement>(`.${CLASS.send}`)!.click();
    expect(ready).toHaveBeenCalledTimes(2);
    expect(dot()).toBe('sending');
    expect(onSubmit).not.toHaveBeenCalled();
    await flush();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(sent);
  });

  it('a destroy while ready is pending submits nothing', async () => {
    const { overlay, onSubmit, selectorOf } = setup(now);
    overlay.destroy();
    await flush();
    expect(selectorOf).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
