// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLASS } from './styles';
import { TRAY_CLASS } from './tray-view';
import type { Overlay } from './overlay';
import { createOverlay } from './overlay';

let overlay: Overlay | undefined;

afterEach(() => {
  overlay?.destroy();
  overlay = undefined;
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

// Builds the overlay on a page whose script tag carries the corner, keeps one comment, returns the list.
function listAt(corner: string): HTMLElement {
  const script = document.createElement('script');
  script.setAttribute('data-passback-corner', corner);
  document.head.appendChild(script);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  overlay = createOverlay({
    doc: document,
    root,
    host,
    selectorOf: (el) => el.tagName.toLowerCase(),
    onSubmit: vi.fn(),
  });
  root.querySelector<HTMLElement>(`.${CLASS.launcher}`)!.click();
  document.body
    .appendChild(document.createElement('div'))
    .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
  const input = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
  input.value = 'one';
  input.dispatchEvent(new Event('input'));
  root.querySelector<HTMLElement>('[data-role="add-more"]')!.click();
  return root.querySelector<HTMLElement>(`.${TRAY_CLASS.tray}`)!;
}

describe('kept comments list corner', () => {
  it('puts the kept comments list on the left when the corner is bottom-left', () => {
    expect(listAt('bottom-left').getAttribute('data-corner')).toBe('bottom-left');
  });

  it('puts the list at the top when the corner is top-left', () => {
    expect(listAt('top-left').getAttribute('data-corner')).toBe('top-left');
  });

  it('leaves the list at the bottom right when the corner is bottom-right', () => {
    expect(listAt('bottom-right').hasAttribute('data-corner')).toBe(false);
  });
});
