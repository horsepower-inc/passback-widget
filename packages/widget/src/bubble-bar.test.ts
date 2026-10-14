// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { DOCK_BELOW, createBubble } from './bubble-view';
import type { BubbleOptions } from './bubble-view';
import { styleSheet } from './styles';

function setup(opts: Partial<BubbleOptions> = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  const onSend = vi.fn();
  const bubble = createBubble(root, {
    anchor: { x: 10, y: 20 },
    onSend,
    onCancel: vi.fn(),
    viewportWidth: () => 1024,
    ...opts,
  });
  const textarea = bubble.element.querySelector('textarea')!;
  const type = (text: string): void => {
    textarea.value = text;
    textarea.dispatchEvent(new Event('input'));
  };
  return { bubble, textarea, type, onSend };
}

const plus = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('button.pb-ico');

describe('comment box bar', () => {
  it('puts the actions group with Send on one bar row under the text area', () => {
    const { bubble, textarea } = setup();
    const bar = bubble.element.querySelector('.pb-bar')!;
    expect(textarea.nextElementSibling).toBe(bar);
    expect([...bar.children].map((c) => c.getAttribute('data-role'))).toEqual(['actions']);
    expect(bar.children[0]!.textContent).toBe('Send');
  });

  it('shows no Add more button when onKeep is not given', () => {
    expect(plus(setup().bubble.element)).toBeNull();
  });

  it('shows an Add more button before the primary when onKeep is given', () => {
    const { bubble } = setup({ onKeep: vi.fn() });
    const button = plus(bubble.element)!;
    expect(button.textContent).toBe('Add more');
    expect(button.getAttribute('data-role')).toBe('add-more');
    expect(button.hasAttribute('data-wide')).toBe(true);
    expect(button.hasAttribute('aria-label')).toBe(false);
    expect(button.nextElementSibling!.getAttribute('data-role')).toBe('send');
  });

  it('R3 shows Add more and the trash icon on the bar and names them for assistive tech', () => {
    const none = setup({ onKeep: vi.fn() });
    expect(none.bubble.element.querySelector('[data-role="discard"]')).toBeNull();
    const onDiscard = vi.fn();
    const { bubble, type } = setup({ onKeep: vi.fn(), onDraw: vi.fn(), onDiscard });
    const bar = bubble.element.querySelector('.pb-bar')!;
    expect([...bar.children].map((k) => k.getAttribute('data-role') ?? k.className)).toEqual([
      'discard',
      'draw',
      'actions',
    ]);
    const trash = bar.querySelector<HTMLButtonElement>('[data-role="discard"]')!;
    expect(trash.className).toBe('pb-ico');
    expect(trash.getAttribute('aria-label')).toBe('Delete this comment');
    expect(trash.title).toBe('Delete this comment');
    expect(trash.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(trash.disabled).toBe(false);
    trash.click();
    expect(onDiscard).toHaveBeenCalledTimes(1);
    type('x');
    bubble.setPending();
    expect(trash.disabled).toBe(true);
  });

  it('keeps the trimmed comment when Add more is clicked', () => {
    const onKeep = vi.fn();
    const { bubble, type } = setup({ onKeep });
    type('  hello  ');
    plus(bubble.element)!.click();
    expect(onKeep).toHaveBeenCalledWith('hello');
  });

  it('disables Add more while the text is blank and while pending', () => {
    const { bubble, type } = setup({ onKeep: vi.fn() });
    expect(plus(bubble.element)!.disabled).toBe(true);
    type('x');
    expect(plus(bubble.element)!.disabled).toBe(false);
    type('  ');
    expect(plus(bubble.element)!.disabled).toBe(true);
    type('x');
    bubble.setPending();
    expect(plus(bubble.element)!.disabled).toBe(true);
  });

  it('docks to the bottom and drops the anchor position when the viewport is narrower than 480px', () => {
    const { bubble } = setup({ viewportWidth: () => DOCK_BELOW - 1 });
    expect(bubble.element.hasAttribute('data-docked')).toBe(true);
    expect(bubble.element.style.left).toBe('');
    expect(bubble.element.style.top).toBe('');
  });

  it('stays next to the pin at a viewport width of 480px', () => {
    const { bubble } = setup({ viewportWidth: () => DOCK_BELOW });
    expect(bubble.element.hasAttribute('data-docked')).toBe(false);
    expect(bubble.element.style.left).toContain('10px');
    expect(bubble.element.style.top).toContain('20px');
  });

  it('returns to the pin when the comment is acked or a status arrives', () => {
    const a = setup({ viewportWidth: () => 300 });
    a.bubble.showAcked('m1', false);
    expect(a.bubble.element.hasAttribute('data-docked')).toBe(false);
    expect(a.bubble.element.style.left).toContain('10px');
    const b = setup({ viewportWidth: () => 300 });
    b.bubble.showStatus({ state: 'running' });
    expect(b.bubble.element.hasAttribute('data-docked')).toBe(false);
    expect(b.bubble.element.style.top).toContain('20px');
  });

  it('has a bar rule that never wraps and a docked rule in the stylesheet', () => {
    const css = styleSheet();
    expect(css).toMatch(/\.pb-bar \{[^}]*flex-wrap: nowrap/);
    expect(css).toMatch(/\.pb-bubble\[data-docked\] \{[^}]*position: fixed/);
  });

  it('puts the pencil before the actions group', () => {
    const { bubble } = setup({ onKeep: vi.fn(), onDraw: vi.fn() });
    const kids = [...bubble.element.querySelector('.pb-bar')!.children];
    expect(kids.map((k) => k.getAttribute('data-role'))).toEqual(['draw', 'actions']);
  });

  it('the primary button reads Send with no kept comment and Send all with one', () => {
    const { bubble } = setup({ onKeep: vi.fn(), onSendAll: vi.fn() });
    const send = bubble.element.querySelector('[data-role="send"]')!;
    expect(send.textContent).toBe('Send');
    bubble.setKept(1);
    expect(send.textContent).toBe('Send all');
    bubble.setKept(0);
    expect(send.textContent).toBe('Send');
    const none = setup({ onKeep: vi.fn(), kept: 2 });
    expect(none.bubble.element.querySelector('[data-role="send"]')!.textContent).toBe('Send');
    const some = setup({ onKeep: vi.fn(), onSendAll: vi.fn(), kept: 2 });
    expect(some.bubble.element.querySelector('[data-role="send"]')!.textContent).toBe('Send all');
    some.bubble.setPending();
    some.bubble.setKept(0);
    expect(some.bubble.element.querySelector('[data-role="send"]')!.textContent).toBe('Send all');
  });

  it('the bar holds the trash, then one actions group with Add more and the primary of equal size and the hint is the primary title', () => {
    const { bubble } = setup({ onKeep: vi.fn(), onDiscard: vi.fn() });
    const bar = bubble.element.querySelector('.pb-bar')!;
    expect([...bar.children].map((k) => k.getAttribute('data-role'))).toEqual([
      'discard',
      'actions',
    ]);
    const group = bar.querySelector('.pb-actions')!;
    expect([...group.children].map((k) => k.getAttribute('data-role'))).toEqual([
      'add-more',
      'send',
    ]);
    expect(group.querySelector('[data-role="send"]')!.getAttribute('title')).toBe('Enter sends');
    expect(bar.querySelector('[data-role="keys"]')).toBeNull();
    const css = styleSheet();
    expect(css).toMatch(/\.pb-actions > \.pb-ico, \.pb-actions > \.pb-send \{[^}]*height: 30px/);
    expect(css).toMatch(/\.pb-actions \{[^}]*margin-left: auto/);
  });

  it('Enter and the primary click call onSendAll when comments are kept and onSend when none are', () => {
    const onSendAll = vi.fn();
    const many = setup({ onKeep: vi.fn(), onSendAll, kept: 1 });
    many.type('hi');
    many.bubble.element.querySelector<HTMLButtonElement>('[data-role="send"]')!.click();
    many.textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(onSendAll).toHaveBeenCalledTimes(2);
    expect(onSendAll).toHaveBeenCalledWith('hi');
    expect(many.onSend).not.toHaveBeenCalled();
    const one = setup({ onKeep: vi.fn(), onSendAll });
    one.type('yo');
    one.bubble.element.querySelector<HTMLButtonElement>('[data-role="send"]')!.click();
    one.textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(one.onSend).toHaveBeenCalledTimes(2);
    expect(onSendAll).toHaveBeenCalledTimes(2);
  });
});
