// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { createBubble } from './bubble-view';

afterEach(() => {
  document.body.innerHTML = '';
});

function setup(onDraw?: (on: boolean) => void) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  const bubble = createBubble(root, {
    anchor: { x: 12, y: 34 },
    onSend: vi.fn(),
    onCancel: vi.fn(),
    onDraw,
  });
  const pencil = bubble.element.querySelector<HTMLButtonElement>('[data-role="draw"]');
  return { bubble, pencil };
}

function look(button: HTMLButtonElement) {
  const bare = (value: string) => value.replace(/\s/g, '');
  return { background: bare(button.style.backgroundColor), border: bare(button.style.borderColor) };
}

it('shows no pencil when no draw handler is given', () => {
  const { bubble, pencil } = setup();
  expect(pencil).toBeNull();
  expect(bubble.element.children).toHaveLength(2);
  expect(() => bubble.setDrawing(true)).not.toThrow();
});

it('shows a pencil named Draw on the page before the other buttons when a draw handler is given', () => {
  const { bubble, pencil } = setup(vi.fn());
  expect(pencil).not.toBeNull();
  expect(pencil!.type).toBe('button');
  expect(pencil!.getAttribute('aria-label')).toBe('Draw on the page');
  expect(pencil!.title).toBe('Draw on the page');
  expect(pencil!.getAttribute('aria-pressed')).toBe('false');
  expect(bubble.element.querySelector('button')).toBe(pencil);
  expect(pencil!.nextElementSibling!.getAttribute('data-role')).toBe('actions');
  const svg = pencil!.querySelector('svg')!;
  expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
  expect(svg.getAttribute('viewBox')).toBe('0 0 16 16');
  expect(svg.getAttribute('width')).toBe('16');
  expect(svg.getAttribute('height')).toBe('16');
  expect(svg.getAttribute('aria-hidden')).toBe('true');
  expect(svg.children).toHaveLength(1);
  expect(svg.firstElementChild!.getAttribute('d')).toBe('M3 13l.8-3.2L10.6 3l2.4 2.4-6.8 6.8z');
});

it('presses the pencil and reports drawing on, then off on the next click', () => {
  const onDraw = vi.fn();
  const { pencil } = setup(onDraw);
  pencil!.click();
  expect(pencil!.getAttribute('aria-pressed')).toBe('true');
  expect(look(pencil!)).toEqual({
    background: 'var(--pb-color-field,#24262c)',
    border: 'var(--pb-color-text,#f4f4f5)',
  });
  pencil!.click();
  expect(pencil!.getAttribute('aria-pressed')).toBe('false');
  expect(look(pencil!)).toEqual({
    background: 'transparent',
    border: 'var(--pb-color-border,#33363d)',
  });
  expect(onDraw.mock.calls).toEqual([[true], [false]]);
});

it('setDrawing changes the pressed state without calling the handler', () => {
  const onDraw = vi.fn();
  const { bubble, pencil } = setup(onDraw);
  bubble.setDrawing(true);
  expect(pencil!.getAttribute('aria-pressed')).toBe('true');
  bubble.setDrawing(false);
  expect(pencil!.getAttribute('aria-pressed')).toBe('false');
  expect(onDraw).not.toHaveBeenCalled();
  for (const replace of [
    (box: typeof bubble) => box.showAcked('mark', false),
    (box: typeof bubble) => box.showStatus({ state: 'running' }),
    (box: typeof bubble) => box.showError('failed', vi.fn()),
  ]) {
    const composing = setup(vi.fn());
    replace(composing.bubble);
    expect(composing.bubble.element.querySelector('[data-role="draw"]')).toBeNull();
  }
});

it('disables the pencil while the comment is being sent', () => {
  const onDraw = vi.fn();
  const { bubble, pencil } = setup(onDraw);
  bubble.setPending();
  expect(pencil!.disabled).toBe(true);
  pencil!.click();
  expect(onDraw).not.toHaveBeenCalled();
});
