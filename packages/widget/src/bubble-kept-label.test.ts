// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import type { Overlay } from './overlay';
import { createOverlay } from './overlay';
import { CLASS } from './styles';

let overlays: Overlay[] = [];

afterEach(() => {
  overlays.forEach((overlay) => overlay.destroy());
  overlays = [];
  document.body.innerHTML = '';
});

function pin(): void {
  const target = document.body.appendChild(document.createElement('div'));
  target.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }),
  );
}

function type(root: ShadowRoot, text: string): void {
  const input = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
  input.value = text;
  input.dispatchEvent(new Event('input'));
}

it('R6 deleting the last kept comment turns the open bubble Send all back into Send', () => {
  const host = document.body.appendChild(document.createElement('div'));
  const root = host.attachShadow({ mode: 'open' });
  const overlay = createOverlay({
    doc: document,
    root,
    host,
    selectorOf: (el) => el.tagName.toLowerCase(),
    onSubmit: vi.fn(),
  });
  overlays.push(overlay);
  overlay.arm();
  pin();
  type(root, 'first');
  root.querySelector<HTMLElement>('[data-role="add-more"]')!.click();
  pin();
  const primary = () => root.querySelector<HTMLElement>('.pb-bubble [data-role="send"]')!;
  expect(primary().textContent).toBe('Send all');
  root.querySelector<HTMLElement>('button[aria-label="Delete comment 1"]')!.click();
  expect(primary().textContent).toBe('Send');
});
