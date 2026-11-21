// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBubble } from './bubble-view';
import { CLASS } from './styles';

const PAGE = 'https://passback.example/legal/privacy/';

afterEach(() => {
  document.body.innerHTML = '';
});

function shadowRoot(): ShadowRoot {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return host.attachShadow({ mode: 'open' });
}

function open(privacyUrl?: string) {
  return createBubble(shadowRoot(), {
    anchor: { x: 12, y: 34 },
    onSend: vi.fn(),
    onCancel: vi.fn(),
    privacyUrl,
  });
}

describe('privacy link in the comment box', () => {
  it('draws no privacy link while the address is not set', () => {
    const bubble = open();
    expect(bubble.element.querySelector('a')).toBeNull();
    expect(bubble.element.children).toHaveLength(2);
  });

  it('draws one What is sent link that opens the page in a new tab', () => {
    const bubble = open(PAGE);
    const links = bubble.element.querySelectorAll('a');
    expect(links).toHaveLength(1);
    const link = links[0]!;
    expect(link.getAttribute('href')).toBe(PAGE);
    expect(link.textContent).toBe('What is sent');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('draws no link for an address that is not http or https', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'not a url']) {
      expect(open(url).element.querySelector('a')).toBeNull();
    }
  });

  it('keeps the link a real anchor after Send in the tab order', () => {
    const bubble = open(PAGE);
    const link = bubble.element.querySelector('a')!;
    const send = bubble.element.querySelector<HTMLButtonElement>(`.${CLASS.send}`)!;
    expect(link.hasAttribute('tabindex')).toBe(false);
    expect(send.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('draws the link in the muted note style with no colour of its own', () => {
    const link = open(PAGE).element.querySelector('a')!;
    expect(link.parentElement!.classList.contains(CLASS.note)).toBe(true);
    expect(link.style.color).toBe('inherit');
  });

  it('removes the link once the box shows that the comment was sent', () => {
    const bubble = open(PAGE);
    bubble.showAcked('m1', false);
    expect(bubble.element.querySelector('a')).toBeNull();
  });
});
