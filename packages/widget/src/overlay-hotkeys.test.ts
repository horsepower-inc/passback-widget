// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hideMarks } from './hide-marks';
import type { Overlay } from './overlay';
import { createOverlay } from './overlay';

const scope = globalThis as { __passback?: unknown };
let overlay: Overlay | undefined;

afterEach(() => {
  overlay?.destroy();
  overlay = undefined;
  delete scope.__passback;
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

function setup(attrs = '') {
  scope.__passback = { fx: { addons: [hideMarks] } };
  document.head.innerHTML = `<script ${attrs}></script>`;
  document.body.innerHTML = '<div></div><p>one</p><p>two</p>';
  const host = document.querySelector('div')!;
  const root = host.attachShadow({ mode: 'open' });
  const onSubmit = vi.fn();
  overlay = createOverlay({ doc: document, root, host, selectorOf: () => 'p', onSubmit });
  const q = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const keydown = (code: string, target: EventTarget = document) => {
    const event = new KeyboardEvent('keydown', {
      altKey: true,
      shiftKey: true,
      code,
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event;
  };
  const open = () => keydown('KeyR');
  const hide = () => keydown('KeyH');
  const pin = (text: string, index = 0) => {
    document.querySelectorAll('p')[index]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    Object.assign(q('textarea'), { value: text }).dispatchEvent(new Event('input'));
  };
  const css = () => [...root.querySelectorAll('style')].map((s) => s.textContent).join('\n');
  return { host, root, q, keydown, open, hide, pin, css, onSubmit, overlay: overlay! };
}

describe('hotkeys', () => {
  it('the open hotkey closes an open widget and opens a closed one', () => {
    const r = setup();
    expect(r.overlay.phase()).toBe('idle');
    r.open();
    expect(r.overlay.phase()).toBe('armed');
    r.open();
    expect(r.overlay.phase()).toBe('idle');
    r.open();
    r.pin('draft');
    expect(r.overlay.phase()).toBe('composing');
    r.open();
    expect(r.overlay.phase()).toBe('idle');
    document.querySelectorAll('p')[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(r.overlay.phase()).toBe('idle');
    r.open();
    expect(r.overlay.phase()).toBe('armed');
    expect(r.onSubmit).not.toHaveBeenCalled();
  });

  it('the hide hotkey hides dots, bubbles and stamps and shows them again without touching marks', () => {
    const r = setup();
    r.open();
    r.pin('first');
    r.q<HTMLElement>('[data-role="add-more"]').click();
    r.pin('second', 1);
    const dots = () => [...r.root.querySelectorAll('.pb-dot')].map((d) => d.outerHTML);
    const before = dots();
    const phase = r.overlay.phase();
    expect(r.hide().defaultPrevented).toBe(true);
    expect(r.host.hasAttribute('data-pb-hide')).toBe(true);
    for (const name of ['pb-dot', 'pb-bubble', 'pb-stamp']) {
      expect(r.css()).toContain(`:host([data-pb-hide]) .${name}`);
    }
    expect(r.css()).toContain('display: none !important');
    expect(r.overlay.phase()).toBe(phase);
    expect(dots()).toEqual(before);
    r.hide();
    expect(r.host.hasAttribute('data-pb-hide')).toBe(false);
    expect(dots()).toEqual(before);
    expect(r.q<HTMLTextAreaElement>('textarea').value).toBe('second');
    expect(r.onSubmit).not.toHaveBeenCalled();
  });

  it('either hotkey can be turned off with off and the other keeps working', () => {
    const a = setup('data-passback-hotkey="off"');
    expect(a.open().defaultPrevented).toBe(false);
    expect(a.overlay.phase()).toBe('idle');
    a.hide();
    expect(a.host.hasAttribute('data-pb-hide')).toBe(true);
    overlay?.destroy();
    const b = setup('data-passback-hide-hotkey="off"');
    b.hide();
    expect(b.host.hasAttribute('data-pb-hide')).toBe(false);
    expect(b.css()).not.toContain('data-pb-hide');
    b.open();
    expect(b.overlay.phase()).toBe('armed');
  });

  it('both hotkeys ignore the comment box while Escape still closes', () => {
    const r = setup();
    r.open();
    r.pin('typed');
    const area = r.q<HTMLTextAreaElement>('textarea');
    const open = r.keydown('KeyR', area);
    const hide = r.keydown('KeyH', area);
    expect(open.defaultPrevented).toBe(false);
    expect(hide.defaultPrevented).toBe(false);
    expect(r.overlay.phase()).toBe('composing');
    expect(r.host.hasAttribute('data-pb-hide')).toBe(false);
    expect(area.value).toBe('typed');
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    expect(r.overlay.phase()).toBe('idle');
  });

  it('the hide hotkey is removed with the overlay and a shared binding runs only open', () => {
    const r = setup();
    r.hide();
    expect(r.host.hasAttribute('data-pb-hide')).toBe(true);
    r.overlay.destroy();
    expect(r.host.hasAttribute('data-pb-hide')).toBe(false);
    expect(r.css()).not.toContain('data-pb-hide');
    r.hide();
    expect(r.host.hasAttribute('data-pb-hide')).toBe(false);
    const s = setup('data-passback-hide-hotkey="alt+shift+r"');
    s.open();
    expect(s.overlay.phase()).toBe('armed');
    expect(s.host.hasAttribute('data-pb-hide')).toBe(false);
  });
});
