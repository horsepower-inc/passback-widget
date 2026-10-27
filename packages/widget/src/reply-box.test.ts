// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendStillWrong, renderAskBox, renderReopenBox } from './reply-box';
import { CLASS } from './styles';

afterEach(() => {
  document.body.innerHTML = '';
});

function setup() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  const element = document.createElement('div');
  root.appendChild(element);
  const onSend = vi.fn();
  const onCancel = vi.fn();
  return { root, element, onSend, onCancel };
}

function open() {
  const ctx = setup();
  const box = renderReopenBox(document, ctx.element, { onSend: ctx.onSend, onCancel: ctx.onCancel });
  return { ...ctx, ...box };
}

function type(textarea: HTMLTextAreaElement, text: string): void {
  textarea.value = text;
  textarea.dispatchEvent(new Event('input'));
}

function press(textarea: HTMLTextAreaElement, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...init });
  textarea.dispatchEvent(event);
  return event;
}

describe('reply box', () => {
  it('appends a Still wrong? button that calls onReopen and keeps what the box already shows', () => {
    const { element } = setup();
    element.innerHTML = '<p>Fixed</p>';
    const onReopen = vi.fn();
    const button = appendStillWrong(document, element, onReopen);
    expect(element.firstElementChild?.textContent).toBe('Fixed');
    expect(element.lastElementChild).toBe(button);
    expect(button.type).toBe('button');
    expect(button.className).toBe(CLASS.send);
    expect(button.getAttribute('data-role')).toBe('reopen');
    expect(button.textContent).toBe('Still wrong?');
    button.click();
    expect(onReopen).toHaveBeenCalledTimes(1);
  });

  it('shows the note What is still wrong?, a labelled text area, the key hint and Send again', () => {
    const { element, textarea, button, root } = open();
    const [note, area, keys, action] = Array.from(element.children);
    expect(note?.textContent).toBe('What is still wrong?');
    expect(note?.className).toBe(CLASS.note);
    expect(area).toBe(textarea);
    expect(textarea.className).toBe(CLASS.input);
    expect(textarea.getAttribute('aria-label')).toBe('What is still wrong');
    expect(keys?.textContent).toBe('Enter sends · Esc cancels');
    expect(keys?.getAttribute('data-role')).toBe('keys');
    expect(action).toBe(button);
    expect(button.textContent).toBe('Send again');
    expect(button.type).toBe('button');
    expect(root.activeElement).toBe(textarea);
  });

  it('keeps Send again disabled while the text is blank or only spaces', () => {
    const { textarea, button } = open();
    expect(button.disabled).toBe(true);
    type(textarea, '  \n ');
    expect(button.disabled).toBe(true);
    type(textarea, 'x');
    expect(button.disabled).toBe(false);
    type(textarea, ' ');
    expect(button.disabled).toBe(true);
  });

  it('sends the trimmed comment on Enter and locks the box', () => {
    const { element, textarea, button, onSend } = open();
    type(textarea, '  still red  ');
    const event = press(textarea, { key: 'Enter' });
    expect(event.defaultPrevented).toBe(true);
    expect(onSend).toHaveBeenCalledWith('still red');
    expect(element.getAttribute('data-state')).toBe('sending');
    expect(textarea.disabled).toBe(true);
    expect(button.disabled).toBe(true);
  });

  it('adds no send on Shift+Enter or while composing', () => {
    const { textarea, onSend } = open();
    type(textarea, 'hello');
    expect(press(textarea, { key: 'Enter', shiftKey: true }).defaultPrevented).toBe(false);
    press(textarea, { key: 'Enter', isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends the comment when Send again is clicked', () => {
    const { textarea, button, onSend } = open();
    type(textarea, 'nope');
    button.click();
    expect(onSend).toHaveBeenCalledWith('nope');
  });

  it('sends once when Enter is pressed twice', () => {
    const { textarea, onSend } = open();
    type(textarea, 'nope');
    press(textarea, { key: 'Enter' });
    press(textarea, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel on Escape and sends nothing', () => {
    const { textarea, onSend, onCancel } = open();
    type(textarea, 'nope');
    press(textarea, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('replaces what the box showed before', () => {
    const { element, onSend, onCancel } = setup();
    element.innerHTML = '<p>Fixed</p><a href="#">link</a>';
    element.setAttribute('data-state', 'done');
    renderReopenBox(document, element, { onSend, onCancel });
    expect(element.querySelector('a')).toBeNull();
    expect(element.textContent).not.toContain('Fixed');
    expect(element.hasAttribute('data-state')).toBe(false);
    expect(element.children).toHaveLength(4);
  });
});

describe('question box', () => {
  function ask(question = 'Which colour?') {
    const ctx = setup();
    const box = renderAskBox(document, ctx.element, { question, onSend: ctx.onSend });
    return { ...ctx, ...box };
  }

  it('shows The agent has a question, the question, a text area labelled Your answer and the Answer button', () => {
    const { element, textarea, button } = ask();
    const [heading, question, area, keys, action] = Array.from(element.children) as HTMLElement[];
    expect(heading?.textContent).toBe('The agent has a question');
    expect(heading?.getAttribute('data-tone')).toBe('ask');
    expect(heading?.style.color).toBe('var(--pb-color-ask)');
    expect(heading?.style.fontWeight).toBe('600');
    expect(heading?.className).not.toBe(CLASS.note);
    expect(question?.textContent).toBe('Which colour?');
    expect(area).toBe(textarea);
    expect(textarea.getAttribute('aria-label')).toBe('Your answer');
    expect(textarea.placeholder).toBe('Your answer');
    expect(keys?.textContent).toBe('Enter sends');
    expect(action).toBe(button);
    expect(button.textContent).toBe('Answer');
  });

  it('renders a question that contains markup as text, not as elements', () => {
    const { element } = ask('<img src=x onerror=alert(1)> <b>bold</b>');
    expect(element.querySelector('img')).toBeNull();
    expect(element.querySelector('b')).toBeNull();
    expect(element.children[1]?.textContent).toBe('<img src=x onerror=alert(1)> <b>bold</b>');
  });

  it('keeps Answer disabled while the answer is blank', () => {
    const { textarea, button } = ask();
    expect(button.disabled).toBe(true);
    type(textarea, '  ');
    expect(button.disabled).toBe(true);
    type(textarea, 'blue');
    expect(button.disabled).toBe(false);
  });

  it('sends the trimmed answer once, on Enter or on Answer, and locks the box', () => {
    const { element, textarea, button, onSend } = ask();
    type(textarea, '  blue  ');
    press(textarea, { key: 'Enter' });
    button.click();
    press(textarea, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('blue');
    expect(element.getAttribute('data-state')).toBe('sending');
    expect(textarea.disabled).toBe(true);
    expect(button.disabled).toBe(true);
  });

  it('does nothing on Escape in the question box', () => {
    const { element, textarea, onSend } = ask();
    type(textarea, 'blue');
    press(textarea, { key: 'Escape' });
    expect(onSend).not.toHaveBeenCalled();
    expect(textarea.disabled).toBe(false);
    expect(element.contains(textarea)).toBe(true);
  });
});
