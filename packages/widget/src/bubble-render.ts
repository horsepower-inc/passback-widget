import { safePrUrl } from './channel';
import { CLASS } from './styles';

export type Status = {
  state: 'queued' | 'running' | 'done' | 'failed';
  message?: string;
  prUrl?: string;
};

export function appendNote(doc: Document, element: HTMLElement, text: string): void {
  const note = doc.createElement('p');
  note.className = CLASS.note;
  note.textContent = text;
  element.appendChild(note);
}

const SAY = {
  sent: 'Sent. Waiting for the agent.',
  trimmed: 'Trimmed to fit the size limit.',
  running: 'The agent is working on it.',
  done: 'Fixed.',
  failed: 'The agent could not fix it.',
  notSent: 'Not sent: ',
  kept: 'Your comment is kept.',
};

const STATE_NOTE: Record<Status['state'], string> = {
  queued: SAY.sent,
  running: SAY.running,
  done: SAY.done,
  failed: SAY.failed,
};

export function renderAcked(doc: Document, element: HTMLElement, trimmed: boolean): void {
  element.textContent = '';
  element.setAttribute('data-state', 'queued');
  element.hidden = false;
  appendNote(doc, element, SAY.sent);
  if (trimmed) {
    appendNote(doc, element, SAY.trimmed);
  }
}

export function renderSent(doc: Document, element: HTMLElement): void {
  element.textContent = '';
  element.setAttribute('data-state', 'sent');
  element.hidden = true;
}

export function renderStatus(doc: Document, element: HTMLElement, status: Status): void {
  element.textContent = '';
  element.setAttribute('data-state', status.state);
  element.hidden = false;
  const message = status.message === '' ? undefined : status.message;
  const sentence = STATE_NOTE[status.state];
  const text =
    status.state === 'failed'
      ? (message ?? sentence)
      : message === undefined
        ? sentence
        : `${sentence} ${message}`;
  appendNote(doc, element, text);
  const prUrl = safePrUrl(status.prUrl);
  if (prUrl !== undefined) {
    const link = doc.createElement('a');
    link.href = prUrl;
    link.textContent = 'Pull request';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    element.appendChild(link);
  }
}

export function renderError(
  doc: Document,
  element: HTMLElement,
  message: string,
  onRetry: () => void,
): void {
  element.textContent = '';
  element.setAttribute('data-state', 'sending');
  element.hidden = false;
  appendNote(doc, element, `${SAY.notSent}${message}`);
  appendNote(doc, element, SAY.kept);
  const retry = doc.createElement('button');
  retry.type = 'button';
  retry.className = CLASS.send;
  retry.textContent = 'Retry';
  retry.addEventListener('click', onRetry);
  element.appendChild(retry);
}

export function setDrawing(button: HTMLButtonElement | undefined, on: boolean): void {
  if (!button) return;
  button.setAttribute('aria-pressed', String(on));
  button.style.backgroundColor = on ? 'var(--pb-color-field,#24262c)' : 'transparent';
  button.style.borderColor = on ? 'var(--pb-color-text,#f4f4f5)' : 'var(--pb-color-border,#33363d)';
}

export function buildTrash(doc: Document, onDiscard: () => void): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = CLASS.ico;
  button.dataset.role = 'discard';
  button.setAttribute('aria-label', 'Delete this comment');
  button.title = 'Delete this comment';
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8h5.8l.6-8M6.8 7v3.5M9.2 7v3.5');
  svg.appendChild(path);
  button.appendChild(svg);
  button.addEventListener('click', onDiscard);
  return button;
}

export function buildPencil(
  send: HTMLButtonElement,
  onDraw: (on: boolean) => void,
): HTMLButtonElement {
  const doc = send.ownerDocument;
  const button = doc.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', 'Draw on the page');
  button.title = 'Draw on the page';
  button.dataset.role = 'draw';
  button.setAttribute('aria-pressed', 'false');
  button.style.cssText =
    'width:30px;height:30px;padding:0;display:grid;place-items:center;flex:none;border:1px solid var(--pb-color-border,#33363d);border-radius:var(--pb-radius-control,6px);background:transparent;color:var(--pb-color-text,#f4f4f5);cursor:pointer';
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText =
    'fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round';
  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M3 13l.8-3.2L10.6 3l2.4 2.4-6.8 6.8z');
  svg.appendChild(path);
  button.appendChild(svg);
  button.addEventListener('click', () => {
    const on = button.getAttribute('aria-pressed') !== 'true';
    setDrawing(button, on);
    onDraw(on);
  });
  const parent = send.closest('.' + CLASS.bar) ?? send.parentElement!;
  parent.insertBefore(
    button,
    parent.querySelector('[data-role="actions"]') ?? parent.querySelector('button'),
  );
  return button;
}

function buildKeep(doc: Document): HTMLButtonElement {
  const keep = doc.createElement('button');
  keep.type = 'button';
  keep.className = CLASS.ico;
  keep.setAttribute('data-role', 'add-more');
  keep.setAttribute('data-wide', '');
  keep.textContent = 'Add more';
  keep.disabled = true;
  return keep;
}

export function buildBar(
  doc: Document,
  withKeep: boolean,
  onDiscard?: () => void,
): {
  bar: HTMLElement;
  send: HTMLButtonElement;
  keep?: HTMLButtonElement;
  trash?: HTMLButtonElement;
} {
  const bar = doc.createElement('div');
  bar.className = CLASS.bar;
  const trash = onDiscard ? buildTrash(doc, onDiscard) : undefined;
  if (trash) bar.appendChild(trash);

  const actions = doc.createElement('div');
  actions.className = CLASS.actions;
  actions.setAttribute('data-role', 'actions');
  const keep = withKeep ? buildKeep(doc) : undefined;
  if (keep) actions.appendChild(keep);

  const send = doc.createElement('button');
  send.type = 'button';
  send.className = CLASS.send;
  send.setAttribute('data-role', 'send');
  send.title = 'Enter sends';
  send.textContent = 'Send';
  send.disabled = true;
  actions.appendChild(send);
  bar.appendChild(actions);
  return { bar, send, keep, trash };
}
