// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBubble } from './bubble-view';
import { CLASS } from './styles';

afterEach(() => {
  document.body.innerHTML = '';
});

function shadowRoot(): ShadowRoot {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return host.attachShadow({ mode: 'open' });
}

function setup(overrides: { onSend?(comment: string): void; onCancel?(): void } = {}) {
  const root = shadowRoot();
  const onSend = overrides.onSend ?? vi.fn();
  const onCancel = overrides.onCancel ?? vi.fn();
  const bubble = createBubble(root, { anchor: { x: 12, y: 34 }, onSend, onCancel });
  const textarea = bubble.element.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
  const send = bubble.element.querySelector<HTMLButtonElement>(`.${CLASS.send}`)!;
  return { root, bubble, onSend, onCancel, textarea, send };
}

function type(textarea: HTMLTextAreaElement, text: string): void {
  textarea.value = text;
  textarea.dispatchEvent(new Event('input'));
}

describe('createBubble', () => {
  it('anchors the bubble at the point and focuses the textarea', () => {
    const { root, bubble, textarea } = setup();
    expect(bubble.element.style.left).toBe('calc(12px + var(--pb-space-gap))');
    expect(bubble.element.style.top).toBe('calc(34px + var(--pb-space-gap))');
    expect(root.activeElement).toBe(textarea);
  });

  it('disables Send while the text is blank', () => {
    const { send, textarea } = setup();
    expect(send.disabled).toBe(true);
    type(textarea, 'hello');
    expect(send.disabled).toBe(false);
  });

  it('treats whitespace only as blank', () => {
    const { send, textarea } = setup();
    type(textarea, '   \n\t ');
    expect(send.disabled).toBe(true);
  });

  it('sends the trimmed comment on Enter', () => {
    const onSend = vi.fn();
    const { textarea } = setup({ onSend });
    type(textarea, '  hello  ');
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    textarea.dispatchEvent(event);
    expect(onSend).toHaveBeenCalledWith('hello');
    expect(event.defaultPrevented).toBe(true);
  });

  it('adds no send on Shift+Enter', () => {
    const onSend = vi.fn();
    const { textarea } = setup({ onSend });
    type(textarea, 'hello');
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    textarea.dispatchEvent(event);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('cancels on Escape', () => {
    const onCancel = vi.fn();
    const { textarea } = setup({ onCancel });
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(onCancel).toHaveBeenCalled();
  });

  it('sends the comment when Send is clicked', () => {
    const onSend = vi.fn();
    const { textarea, send } = setup({ onSend });
    type(textarea, 'hello there');
    send.click();
    expect(onSend).toHaveBeenCalledWith('hello there');
  });

  it('locks the input while pending', () => {
    const { bubble, textarea, send } = setup();
    type(textarea, 'hello');
    bubble.setPending();
    expect(bubble.element.getAttribute('data-state')).toBe('sending');
    expect(textarea.disabled).toBe(true);
    expect(send.disabled).toBe(true);
  });

  it('says the comment was sent and shows no id when acked', () => {
    const { bubble } = setup();
    bubble.showAcked('inbox-123', false);
    const notes = bubble.element.querySelectorAll(`.${CLASS.note}`);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.textContent).toBe('Sent. Waiting for the agent.');
    expect(bubble.element.textContent).not.toContain('inbox-123');
  });

  it('notes a trimmed ack', () => {
    const { bubble } = setup();
    bubble.showAcked('inbox-123', true);
    const notes = bubble.element.querySelectorAll(`.${CLASS.note}`);
    expect(notes).toHaveLength(2);
    expect(notes[0]!.textContent).toBe('Sent. Waiting for the agent.');
    expect(notes[1]!.textContent).toBe('Trimmed to fit the size limit.');
  });

  it('says the comment was not sent, that it is kept, and offers Retry', () => {
    const { bubble } = setup();
    const onRetry = vi.fn();
    bubble.showError('the server did not answer.', onRetry);
    const notes = bubble.element.querySelectorAll(`.${CLASS.note}`);
    expect(notes).toHaveLength(2);
    expect(notes[0]!.textContent).toBe('Not sent: the server did not answer.');
    expect(notes[1]!.textContent).toBe('Your comment is kept.');
    const retry = bubble.element.querySelector<HTMLButtonElement>(`.${CLASS.send}`)!;
    expect(retry.textContent).toBe('Retry');
    retry.click();
    expect(onRetry).toHaveBeenCalled();
  });

  it('carries the mark id on the bubble as data-mark-id once acked', () => {
    const { bubble } = setup();
    bubble.showAcked('inbox-123', false);
    expect(bubble.element.getAttribute('data-mark-id')).toBe('inbox-123');
  });

  it('has no data-mark-id before the ack and none after a send error', () => {
    const { bubble } = setup();
    expect(bubble.element.hasAttribute('data-mark-id')).toBe(false);
    bubble.setPending();
    bubble.showError('Something went wrong', vi.fn());
    expect(bubble.element.hasAttribute('data-mark-id')).toBe(false);
  });

  it('keeps data-mark-id when a status replaces the text', () => {
    const { bubble } = setup();
    bubble.showAcked('inbox-123', false);
    bubble.showStatus({ state: 'running' });
    expect(bubble.element.getAttribute('data-mark-id')).toBe('inbox-123');
  });

  it('removes the bubble on destroy', () => {
    const { root, bubble } = setup();
    bubble.destroy();
    expect(root.contains(bubble.element)).toBe(false);
  });

  it('showStatus says a plain sentence for each state and replaces earlier content', () => {
    const { bubble } = setup();
    bubble.showAcked('inbox-123', false);
    const expected: Array<[Parameters<typeof bubble.showStatus>[0]['state'], string]> = [
      ['queued', 'Sent. Waiting for the agent.'],
      ['running', 'The agent is working on it.'],
      ['done', 'Fixed.'],
      ['failed', 'The agent could not fix it.'],
    ];
    for (const [state, sentence] of expected) {
      bubble.showStatus({ state });
      const notes = bubble.element.querySelectorAll(`.${CLASS.note}`);
      expect(notes).toHaveLength(1);
      expect(notes[0]!.textContent).toBe(sentence);
    }
    expect(bubble.element.querySelector('button')).toBeNull();
  });

  it('R4 shows agent comments as literal text beside local status', () => {
    const { bubble } = setup();
    const note = (): string[] =>
      [...bubble.element.querySelectorAll(`.${CLASS.note}`)].map((n) => n.textContent ?? '');
    bubble.showStatus({ state: 'queued', message: 'in line' });
    expect(note()).toEqual(['Sent. Waiting for the agent. in line']);
    bubble.showStatus({ state: 'running', message: 'building' });
    expect(note()).toEqual(['The agent is working on it. building']);
    bubble.showStatus({ state: 'running' });
    expect(note()).toEqual(['The agent is working on it.']);
    bubble.showStatus({ state: 'running', message: '' });
    expect(note()).toEqual(['The agent is working on it.']);
    bubble.showStatus({ state: 'done', message: '<img src=x onerror=alert(1)>' });
    expect(note()).toEqual(['Fixed. <img src=x onerror=alert(1)>']);
    expect(bubble.element.querySelector('img')).toBeNull();
    bubble.showStatus({ state: 'failed', message: 'nope' });
    expect(note()).toEqual(['nope']);
    bubble.showStatus({ state: 'failed' });
    expect(note()).toEqual(['The agent could not fix it.']);
    bubble.showStatus({ state: 'done', message: 'ok', prUrl: 'https://example.com/pr/1' });
    expect(bubble.element.querySelector('a')?.getAttribute('href')).toBe(
      'https://example.com/pr/1',
    );
    expect(note()).toEqual(['Fixed. ok']);
  });

  it('R4 clears Sent pill styling when the bubble changes state', () => {
    const { bubble } = setup();
    bubble.showSent();
    expect(bubble.element.getAttribute('data-state')).toBe('sent');
    bubble.showAcked('x', false);
    expect(bubble.element.getAttribute('data-state')).toBe('queued');
    expect(bubble.element.querySelector('[data-role="sent"]')).toBeNull();
    bubble.showSent();
    bubble.showStatus({ state: 'running' });
    expect(bubble.element.getAttribute('data-state')).toBe('running');
    bubble.showSent();
    bubble.showError('bad', () => undefined);
    expect(bubble.element.getAttribute('data-state')).not.toBe('sent');
    expect(bubble.element.querySelector('[data-role="sent"]')).toBeNull();
  });

  it('showStatus links an http or https prUrl with target and rel', () => {
    const { bubble } = setup();
    bubble.showStatus({ state: 'done', prUrl: 'https://example.com/pr/1' });
    const link = bubble.element.querySelector('a')!;
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('https://example.com/pr/1');
    expect(link.textContent).toBe('Pull request');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('showStatus omits a javascript, data or malformed prUrl and keeps the notes', () => {
    const { bubble } = setup();
    bubble.showStatus({ state: 'done', message: 'ok', prUrl: 'javascript:alert(1)' });
    expect(bubble.element.querySelector('a')).toBeNull();
    let notes = bubble.element.querySelectorAll(`.${CLASS.note}`);
    expect(notes).toHaveLength(1);

    bubble.showStatus({ state: 'done', prUrl: 'data:text/html,<script>alert(1)</script>' });
    expect(bubble.element.querySelector('a')).toBeNull();

    bubble.showStatus({ state: 'done', prUrl: 'not a url' });
    expect(bubble.element.querySelector('a')).toBeNull();
    notes = bubble.element.querySelectorAll(`.${CLASS.note}`);
    expect(notes).toHaveLength(1);
  });
});

describe('bubble moveTo and showNote', () => {
  it('moveTo re-anchors the bubble at the new point', () => {
    const { bubble } = setup();
    bubble.moveTo({ x: 90, y: 70 });
    expect(bubble.element.style.left).toBe('calc(90px + var(--pb-space-gap))');
    expect(bubble.element.style.top).toBe('calc(70px + var(--pb-space-gap))');
  });

  it('showNote adds a hint line and keeps the acked text', () => {
    const { bubble } = setup();
    bubble.showAcked('pb-1', false);
    bubble.showNote('state reset');
    const hints = bubble.element.querySelectorAll('[data-role="hint"]');
    expect(hints).toHaveLength(1);
    expect(hints[0]!.className).toBe(CLASS.note);
    expect(hints[0]!.textContent).toBe('state reset');
    expect(bubble.element.textContent).toContain('Sent. Waiting for the agent.');
  });

  it('showNote replaces the earlier hint and renders it as literal text', () => {
    const { bubble, textarea } = setup();
    bubble.showNote('first');
    bubble.showNote('<b>orphaned</b>');
    const hints = bubble.element.querySelectorAll('[data-role="hint"]');
    expect(hints).toHaveLength(1);
    expect(hints[0]!.textContent).toBe('<b>orphaned</b>');
    expect(hints[0]!.querySelector('b')).toBeNull();
    expect(bubble.element.contains(textarea)).toBe(true);
  });
});
