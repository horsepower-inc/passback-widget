import { CLASS } from './styles';

export const TRAY_CLASS = {
  tray: 'pb-tray',
  list: 'pb-list',
  head: 'pb-head',
  toggle: 'pb-toggle',
} as const;

export type Corner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

// A kept mark has its number n; `act` runs one of the row's buttons.
type Flags = { n?: number; locked?: boolean };
export type MarkRow = Flags & { comment: string; act(a: RowAction): void };
export type RowAction = 'delete';
export type Tray = {
  element: HTMLElement;
  render(rows: readonly MarkRow[], notice?: string): void;
  setSending(sending: boolean): void;
  showError(reason: string): void;
  destroy(): void;
};

const NOTE = 'Click to add more';
const E = 'calc(var(--pb-space-gap) * 1.5)';
const Y = 'calc(var(--pb-size-launcher) + var(--pb-space-gap) * 1.5 + var(--pb-space-pad))';

export function countLabel(n: number): string {
  return n === 1 ? '1 comment' : `${n} comments`;
}

export function trayRules(): string {
  const { tray, list, head, toggle } = TRAY_CLASS;
  return [
    `.${tray} { position: fixed; right: ${E}; bottom: ${Y}; width: min(var(--pb-size-box), calc(100% - var(--pb-space-gap) * 3)); display: flex; flex-direction: column; gap: var(--pb-space-gap); padding: var(--pb-space-pad); border: thin solid var(--pb-color-border); border-radius: var(--pb-radius-box); background: var(--pb-color-surface); color: var(--pb-color-text); font: var(--pb-font-body); box-shadow: var(--pb-shadow-box); pointer-events: auto; }`,
    `.${tray}[data-corner='bottom-left'] { right: auto; left: ${E}; }`,
    `.${tray}[data-corner='top-right'] { bottom: auto; top: ${Y}; }`,
    `.${tray}[data-corner='top-left'] { right: auto; bottom: auto; left: ${E}; top: ${Y}; }`,
    `.${tray} p { margin: 0; }`,
    `.${list} { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; max-height: 40vh; overflow-y: auto; }`,
    `.${list} li { display: flex; flex: none; align-items: center; gap: var(--pb-space-gap); height: calc(var(--pb-space-gap) * 3.5); }`,
    `.${list} b { flex: none; min-width: 2ch; text-align: right; color: var(--pb-color-text-muted); font-weight: 600; }`,
    `.${list} span { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`,
    `.${list} button { flex: none; display: flex; padding: 0; color: var(--pb-color-text-muted); background: none; border: none; cursor: pointer; }`,
    `.${list} button:disabled { cursor: default; opacity: var(--pb-opacity-idle); }`,
    `.${list} svg { width: calc(var(--pb-space-gap) * 2); height: calc(var(--pb-space-gap) * 2); fill: none; stroke: currentColor; stroke-width: calc(var(--pb-space-gap) * 0.1875); }`,
    `.${head} { display: flex; align-items: center; justify-content: space-between; gap: var(--pb-space-gap); }`,
    `.${head} button { padding: 0; font: var(--pb-font-body); color: inherit; background: none; border: none; cursor: pointer; }`,
    `.${head} .${toggle} { display: inline-flex; align-items: center; gap: calc(var(--pb-space-gap) * 0.5); min-width: calc(var(--pb-space-gap) * 3); min-height: calc(var(--pb-space-gap) * 3); border-radius: var(--pb-radius-box); }`,
    `.${head} .${toggle}:hover { background: var(--pb-color-border); }`,
    `.${head} .${toggle}:focus-visible { outline: thin solid var(--pb-color-text); outline-offset: thin; }`,
    `.${head} .${toggle} svg { flex: none; width: calc(var(--pb-space-gap) * 2); height: calc(var(--pb-space-gap) * 2); fill: none; stroke: currentColor; stroke-width: calc(var(--pb-space-gap) * 0.1875); transition: transform var(--pb-motion-duration) var(--pb-motion-ease); }`,
    `.${head} .${toggle}[aria-expanded='false'] svg { transform: rotate(-90deg); }`,
    `@media (prefers-reduced-motion: reduce) { .${head} .${toggle} svg { transition: none; } }`,
    `.${tray}[data-squeezed], .${tray}[data-collapsed] { width: auto; flex-direction: row; align-items: center; padding: calc(var(--pb-space-gap) * 0.5) var(--pb-space-pad); border-radius: var(--pb-size-launcher); }`,
    `.${tray}[data-squeezed] > :not(.${head}), .${tray}[data-squeezed] .${head} > :not(.${toggle}), .${tray}[data-collapsed] > :not(.${head}), .${tray}[data-collapsed] .${head} > :not(.${toggle}) { display: none; }`,
  ].join('\n');
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  cls?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}

const TRASH = 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8h5.8l.6-8M6.8 7v3.5M9.2 7v3.5';

function trashIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const path = document.createElementNS(ns, 'path');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  path.setAttribute('d', TRASH);
  svg.append(path);
  return svg;
}

function chevronIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const path = document.createElementNS(ns, 'path');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  path.setAttribute('d', 'M4 6l4 4 4-4');
  svg.append(path);
  return svg;
}

function trashButton(
  n: number | undefined,
  onclick: () => void,
  disabled: boolean,
): HTMLButtonElement {
  const button = Object.assign(el('button'), { type: 'button', disabled, onclick });
  button.setAttribute('aria-label', `Delete comment ${n ?? ''}`.trim());
  button.append(trashIcon());
  return button;
}

function buildList(rows: readonly MarkRow[]): HTMLElement {
  const ol = el('ol', undefined, TRAY_CLASS.list);
  rows.forEach(({ n, comment, locked, act }) => {
    const li = el('li');
    li.append(el('b', n === undefined ? '•' : String(n)), el('span', comment));
    li.append(trashButton(n, () => act('delete'), locked ?? false));
    ol.append(li);
  });
  return ol;
}

function textButton(text: string, cls: string | undefined, onclick: () => void): HTMLButtonElement {
  return Object.assign(el('button', text, cls), { type: 'button', onclick });
}

function setExpanded(button: HTMLElement, open: boolean): void {
  button.setAttribute('aria-expanded', String(open));
  button.title = open ? 'Collapse' : 'Expand';
}

function buildHead(
  n: number,
  collapsed: boolean,
  toggle: () => void,
  discard: () => void,
): HTMLElement {
  const head = el('div', undefined, TRAY_CLASS.head);
  const chevron = textButton(`${n} to send`, TRAY_CLASS.toggle, toggle);
  chevron.prepend(chevronIcon());
  setExpanded(chevron, !collapsed);
  head.append(chevron, textButton('Discard all', undefined, discard));
  return head;
}

function markSending(row: ReturnType<typeof buildRow>, sending: boolean): void {
  row.button.disabled = sending;
  row.note.textContent = sending ? 'Sending…' : NOTE;
}

function buildRow(): { row: HTMLElement; note: HTMLElement; button: HTMLButtonElement } {
  const row = el('div', undefined, CLASS.bar);
  const note = el('span', NOTE, CLASS.note);
  const button = el('button', 'Send all', CLASS.send);
  button.type = 'button';
  row.append(note, button);
  return { row, note, button };
}

function errorLines(reason: string, n: number): HTMLElement[] {
  const kept = n === 1 ? 'Your comment is kept.' : 'Your comments are kept.';
  return [`Not sent. ${reason}`, kept].map((text) => {
    const p = el('p', text, CLASS.note);
    p.dataset.role = 'error';
    return p;
  });
}

function installRules(root: ShadowRoot): void {
  if (root.querySelector('style[data-pb-tray-styles]')) return;
  const style = el('style', trayRules());
  style.setAttribute('data-pb-tray-styles', '');
  root.append(style);
}

function addControls(notice?: string): HTMLElement[] {
  return notice === undefined ? [] : [el('p', notice, CLASS.note)];
}

function buildElement(corner?: Corner): HTMLElement {
  const element = el('div', undefined, TRAY_CLASS.tray);
  element.setAttribute('role', 'region');
  element.setAttribute('aria-label', 'Kept comments');
  if (corner && corner !== 'bottom-right') element.dataset.corner = corner;
  return element;
}

function emptyPanel(root: ShadowRoot, element: HTMLElement, add: HTMLElement[]): void {
  if (add.length === 0) {
    element.remove();
    return;
  }
  element.replaceChildren(...add);
  if (!element.isConnected) root.append(element);
}

type TrayOpts = {
  onSendAll(): void;
  onDiscardAll?(): void;
  corner?: Corner;
};

export function createTray(root: ShadowRoot, opts: TrayOpts): Tray {
  installRules(root);
  const element = buildElement(opts.corner);

  let [count, collapsed] = [0, false];
  let row: ReturnType<typeof buildRow> | null = null;
  let chevron: HTMLElement | null = null;
  let errors: HTMLElement[] = [];

  const setSending = (sending: boolean): void => void (row && markSending(row, sending));
  const toggle = (): void => {
    collapsed = !collapsed;
    element.toggleAttribute('data-collapsed', collapsed);
    if (chevron) setExpanded(chevron, !collapsed);
  };
  const api: Tray = {
    element,
    render(rows, notice) {
      [count, errors] = [rows.length, []];
      element.toggleAttribute('data-collapsed', collapsed && count > 0);
      const add = addControls(notice);
      row = count === 0 ? null : buildRow();
      row?.button.addEventListener('click', () => opts.onSendAll());
      chevron = null;
      if (!row) return emptyPanel(root, element, add);
      const head = buildHead(count, collapsed, toggle, () => opts.onDiscardAll?.());
      chevron = head.firstElementChild as HTMLElement;
      element.replaceChildren(head, buildList(rows), ...add, row.row);
      if (!element.isConnected) root.append(element);
    },
    setSending,
    showError(reason) {
      if (!row) return;
      setSending(false);
      errors.forEach((p) => p.remove());
      errors = errorLines(reason, count);
      row.row.before(...errors);
    },
    destroy() {
      element.remove();
    },
  };
  return api;
}
