// @vitest-environment happy-dom
import type { ResolveTarget } from '@passback/collectors';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RestoreEntry } from './inbox-restore';
import { createOverlay } from './overlay';
import { armWidget } from './test-arm';

const TARGET = { selectors: [], tag: 'p', text: 'x' } as unknown as ResolveTarget;

afterEach(() => {
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
    selectorOf: () => 'p',
    targetOf: () => TARGET,
    onSubmit: vi.fn(),
  });
  return { root, overlay };
}
function elementAt(left: number, top: number): Element {
  const el = document.createElement('p');
  el.getBoundingClientRect = () => ({ left, top, right: left + 10, bottom: top + 10 }) as DOMRect;
  document.body.appendChild(el);
  return el;
}
const entry = (id: string, n: number, over: Partial<RestoreEntry> = {}): RestoreEntry => ({
  id,
  n,
  target: TARGET,
  state: 'queued',
  element: elementAt(5 * n, 7 * n),
  ...over,
});
const dots = (root: ShadowRoot) =>
  [...root.querySelectorAll<HTMLElement>('[data-state]')].filter(
    (e) => e.getAttribute('role') === 'img',
  );

describe('overlay restore', () => {
  it('adds a numbered mark on the element for each entry with its state and leaves the focus where it was', () => {
    const { root, overlay } = setup();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const blurs = vi.fn();
    input.addEventListener('blur', blurs);
    overlay.restore([
      entry('a', 1),
      entry('b', 2, { state: 'done', message: 'Changed the label.' }),
    ]);
    const found = dots(root);
    expect(found.map((d) => [d.textContent, d.getAttribute('data-state')])).toEqual([
      ['1', 'queued'],
      ['2', 'done'],
    ]);
    expect([found[1]!.style.left, found[1]!.style.top]).toEqual(['10px', '14px']);
    expect(root.textContent).toContain('Changed the label.');
    expect(root.textContent).not.toContain('FIXED');
    expect(document.activeElement).toBe(input);
    expect(blurs).not.toHaveBeenCalled();
    expect(overlay.openMarks().map((m) => m.id)).toEqual(['a', 'b']);
    const editor = document.createElement('textarea');
    root.appendChild(editor);
    editor.focus();
    overlay.restore([entry('a', 1), entry('c', 3)]);
    expect(root.activeElement).toBe(editor);
  });

  it('skips an entry whose id belongs to a mark made in this session', () => {
    const { root, overlay } = setup();
    armWidget(root);
    const el = elementAt(1, 1);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
    const input = root.querySelector<HTMLTextAreaElement>('textarea')!;
    input.value = 'c';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    overlay.acked('mine', false);
    overlay.restore([entry('mine', 1, { state: 'done' }), entry('other', 2)]);
    expect(dots(root).map((d) => [d.textContent, d.getAttribute('data-state')])).toEqual([
      ['1', 'queued'],
      ['2', 'queued'],
    ]);
    overlay.restore([]);
    expect(dots(root)).toHaveLength(1);
  });

  it('updates the state of a restored mark and replaces it when its number changes', () => {
    const { root, overlay } = setup();
    const el = elementAt(5, 5);
    overlay.restore([entry('a', 1, { element: el })]);
    const first = dots(root)[0]!;
    overlay.restore([entry('a', 1, { element: el, state: 'running', message: 'On it' })]);
    expect(dots(root)[0]).toBe(first);
    expect(first.getAttribute('data-state')).toBe('running');
    expect(root.textContent).toContain('On it');
    overlay.restore([entry('a', 3, { element: el, state: 'running', message: 'On it' })]);
    expect(dots(root)).toHaveLength(1);
    expect(dots(root)[0]).not.toBe(first);
    expect(dots(root)[0]!.textContent).toBe('3');
  });

  it('removes a restored mark when its entry is gone and keeps the marks of this session', () => {
    const { root, overlay } = setup();
    overlay.restore([entry('a', 1), entry('b', 2)]);
    overlay.restore([entry('b', 2)]);
    expect(dots(root).map((d) => d.textContent)).toEqual(['2']);
    overlay.restore([]);
    expect(dots(root)).toHaveLength(0);
  });

  it('lets the HMR reattach find a restored mark again through its target', () => {
    const { root, overlay } = setup();
    overlay.restore([entry('a', 1)]);
    const [open] = overlay.openMarks();
    expect(open).toEqual({ id: 'a', target: TARGET });
    const moved = elementAt(40, 50);
    overlay.reattach([{ mark: open!, element: moved, orphaned: false }], { kind: 'kept' } as never);
    const dot = dots(root)[0]!;
    expect([dot.style.left, dot.style.top]).toEqual(['40px', '50px']);
  });
});
