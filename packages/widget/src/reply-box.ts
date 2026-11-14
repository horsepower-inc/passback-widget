import { bubbleKey, readyComment } from './bubble';
import { CLASS } from './styles';

export type ReplyLine = { text: string; tone?: 'muted' | 'ask' };
export type ReplyBoxOptions = {
  lines: readonly ReplyLine[];
  label: string;
  placeholder?: string;
  hint: string;
  action: string;
  onSend(text: string): void;
  onCancel?(): void;
};
export type ReplyBox = { textarea: HTMLTextAreaElement; button: HTMLButtonElement };

function textNode(doc: Document, text: string, className?: string): HTMLParagraphElement {
  const p = doc.createElement('p');
  p.textContent = text;
  if (className !== undefined) {
    p.className = className;
  }
  return p;
}

function lineNode(doc: Document, line: ReplyLine): HTMLParagraphElement {
  const p = textNode(doc, line.text, line.tone === 'muted' ? CLASS.note : undefined);
  if (line.tone === 'ask') {
    p.setAttribute('data-tone', 'ask');
    p.style.color = 'var(--pb-color-ask)';
    p.style.fontWeight = '600';
  }
  return p;
}

function buildReplyBox(doc: Document, element: HTMLElement, opts: ReplyBoxOptions): ReplyBox {
  element.textContent = '';
  element.removeAttribute('data-state');
  for (const line of opts.lines) {
    element.appendChild(lineNode(doc, line));
  }
  const textarea = doc.createElement('textarea');
  textarea.className = CLASS.input;
  textarea.setAttribute('aria-label', opts.label);
  if (opts.placeholder !== undefined) {
    textarea.placeholder = opts.placeholder;
  }
  element.appendChild(textarea);
  const keys = textNode(doc, opts.hint, CLASS.note);
  keys.setAttribute('data-role', 'keys');
  element.appendChild(keys);
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = CLASS.send;
  button.textContent = opts.action;
  button.disabled = true;
  element.appendChild(button);
  return { textarea, button };
}

export function renderReplyBox(doc: Document, element: HTMLElement, opts: ReplyBoxOptions): ReplyBox {
  const { textarea, button } = buildReplyBox(doc, element, opts);
  let sent = false;
  const send = (): void => {
    const text = readyComment({ text: textarea.value });
    if (sent || text === null) {
      return;
    }
    sent = true;
    element.setAttribute('data-state', 'sending');
    textarea.disabled = true;
    button.disabled = true;
    opts.onSend(text);
  };
  textarea.addEventListener('input', () => {
    button.disabled = readyComment({ text: textarea.value }) === null;
  });
  textarea.addEventListener('keydown', (event) => {
    const action = bubbleKey(
      { key: event.key, shiftKey: event.shiftKey, isComposing: event.isComposing },
      { text: textarea.value },
    );
    if (action === 'send') {
      event.preventDefault();
      send();
    } else if (action === 'cancel') {
      opts.onCancel?.();
    }
  });
  button.addEventListener('click', send);
  textarea.focus();
  return { textarea, button };
}

export function appendStillWrong(doc: Document, element: HTMLElement, onReopen: () => void): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = CLASS.send;
  button.setAttribute('data-role', 'reopen');
  button.textContent = 'Still wrong?';
  button.addEventListener('click', onReopen);
  element.appendChild(button);
  return button;
}

export function renderReopenBox(
  doc: Document,
  element: HTMLElement,
  handlers: { onSend(comment: string): void; onCancel(): void },
): ReplyBox {
  return renderReplyBox(doc, element, {
    lines: [{ text: 'What is still wrong?', tone: 'muted' }],
    label: 'What is still wrong',
    hint: 'Enter sends · Esc cancels',
    action: 'Send again',
    onSend: handlers.onSend,
    onCancel: handlers.onCancel,
  });
}

export function renderAskBox(
  doc: Document,
  element: HTMLElement,
  opts: { question: string; onSend(answer: string): void },
): ReplyBox {
  return renderReplyBox(doc, element, {
    lines: [{ text: 'The agent has a question', tone: 'ask' }, { text: opts.question }],
    label: 'Your answer',
    placeholder: 'Your answer',
    hint: 'Enter sends',
    action: 'Answer',
    onSend: opts.onSend,
  });
}
