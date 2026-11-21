// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBubble } from './bubble-view';
import { createDot, createOutline } from './dot-view';

afterEach(() => {
  document.body.innerHTML = '';
});

function shadowRoot(): ShadowRoot {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return host.attachShadow({ mode: 'open' });
}

describe('shadow parts', () => {
  it('names the pin part pin and its state, and follows each state change', () => {
    const dot = createDot(shadowRoot(), { x: 1, y: 2 });
    expect(dot.element.getAttribute('part')).toBe('pin pin-pinned');
    for (const state of ['sending', 'queued', 'running', 'done', 'failed', 'orphaned'] as const) {
      dot.setState(state);
      expect(dot.element.getAttribute('part')).toBe(`pin pin-${state}`);
      expect(dot.element.getAttribute('data-state')).toBe(state);
    }
  });

  it('names the choosing hint part hint', () => {
    const root = shadowRoot();
    createOutline(root);
    const hint = [...root.querySelectorAll('[role="status"]')].find(
      (el) => el.getAttribute('part') === 'hint',
    );
    expect(hint).toBeDefined();
    expect(hint?.textContent).toContain('Click anything to comment');
  });

  it('names the comment box part box from the start', () => {
    const bubble = createBubble(shadowRoot(), {
      anchor: { x: 1, y: 2 },
      onSend: vi.fn(),
      onCancel: vi.fn(),
    });
    expect(bubble.element.getAttribute('part')).toBe('box');
    bubble.showError('boom', vi.fn());
    expect(bubble.element.getAttribute('part')).toBe('box');
  });

  it('adds the status to the comment box part when a status arrived', () => {
    const bubble = createBubble(shadowRoot(), {
      anchor: { x: 1, y: 2 },
      onSend: vi.fn(),
      onCancel: vi.fn(),
    });
    for (const state of ['queued', 'running', 'done', 'failed'] as const) {
      bubble.showStatus({ state });
      expect(bubble.element.getAttribute('part')).toBe(`box box-${state}`);
    }
  });
});
