import { createInboxFeed } from './inbox-feed';
import {
  clearCounts,
  clearOf,
  UNDO_MS,
  type ClearAnswer,
  type ClearCounts,
  type ClearPort,
  type ClearRequest,
  type ClearRow,
  type ClearScope,
} from './inbox-clear';
import { openClearDialog } from './inbox-clear-dialog';
import { menuRules } from './inbox-menu-styles';

type Timer = ReturnType<typeof setTimeout>;
export type InboxMenuOptions = { card: HTMLElement; button: HTMLElement; win: Window };

const STYLE = 'data-pb-clear-style';
const RESULT_MS = 4000;
const EARLIER = 'An earlier clear failed.';
const FAILED = 'Could not clear. Try again.';
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const comments = (n: number): string => plural(n, 'comment');

const ITEMS: { scope: ClearScope; label: string; count?: keyof ClearCounts }[] = [
  { scope: 'fixed', label: 'Clear fixed', count: 'fixed' },
  { scope: 'tracker', label: 'Clear sent to tracker', count: 'tracker' },
  { scope: 'workspace', label: 'Clear workspace…' },
];

function resultLine(answer: ClearAnswer | undefined): string {
  if (!answer) return FAILED;
  if (answer.scope !== 'workspace') return `Cleared ${comments(answer.comments)}.`;
  const parts = [
    comments(answer.comments),
    `${answer.attachments} screenshots and recordings`,
    plural(answer.answers, 'answer'),
    `${answer.done} done`,
  ];
  const line = `Cleared ${parts.join(', ')}.`;
  return answer.settings ? `${line} Settings deleted. Run passback init to set it up again.` : line;
}

/** The status bar at the bottom of the panel: one line, an optional Undo, and a result that fades. */
function createBar(card: HTMLElement) {
  const doc = card.ownerDocument;
  let bar: HTMLElement | undefined;
  let timer: Timer | undefined;
  let earlier = false;
  let text = '';
  let line: HTMLElement | undefined;
  const fade = (): void => {
    clearTimeout(timer);
    timer = setTimeout(hide, RESULT_MS);
  };
  function hide(): void {
    clearTimeout(timer);
    timer = undefined;
    earlier = false;
    bar?.remove();
    bar = line = undefined;
  }
  const paint = (): void => {
    if (line) line.textContent = earlier ? [EARLIER, text].filter(Boolean).join(' ') : text;
  };
  const show = (next: string, undo?: () => void): void => {
    clearTimeout(timer);
    timer = undefined;
    if (!bar) {
      bar = doc.createElement('div');
      bar.className = 'pb-cb';
      bar.setAttribute('role', 'status');
      card.append(bar);
    }
    text = next;
    line = doc.createElement('span');
    bar.replaceChildren(line);
    paint();
    if (!undo) return;
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Undo';
    btn.addEventListener('click', undo);
    bar.append(btn);
  };
  const flash = (next: string): void => {
    show(next);
    fade();
  };
  /** An earlier clear failed: keep one sentence in front of every line until the bar hides. */
  const note = (): void => {
    if (earlier) return;
    earlier = true;
    if (!bar) return flash('');
    paint();
    if (timer) fade();
  };
  /** The newer clear was undone: hide, or leave a held sentence alone for a while. */
  const end = (): void => (earlier ? flash('') : hide());
  return { show, hide, flash, note, end };
}

type Popup = { toggle(): void; refresh(): void; close(refocus: boolean): void };

/** The menu element: items with counts, arrow keys, Esc and outside-press closing. */
function createPopup(o: {
  card: HTMLElement;
  button: HTMLElement;
  target: Document;
  counts(): ClearCounts;
  available(): boolean;
  pick(scope: ClearScope): void;
}): Popup {
  const { card, button, target } = o;
  const doc = card.ownerDocument;
  let menu: HTMLElement | undefined;
  const items = (): HTMLButtonElement[] => [
    ...(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
  ];
  const refresh = (): void => {
    if (!menu) return;
    const counts = o.counts();
    const ok = o.available();
    ITEMS.forEach((item, i) => {
      const el = items()[i];
      const n = item.count ? counts[item.count] : 0;
      if (!el) return;
      el.disabled = !ok || (item.count !== undefined && n === 0);
      el.querySelector('.pb-cm-count')?.replaceChildren(n > 0 ? String(n) : '');
    });
    menu.querySelector('.pb-cm-note')?.remove();
    if (ok) return;
    const note = doc.createElement('p');
    note.className = 'pb-cm-note';
    note.textContent = 'Clearing is not available in this setup.';
    menu.append(note);
  };
  const close = (refocus: boolean): void => {
    if (!menu) return;
    menu.remove();
    menu = undefined;
    card.removeEventListener('keydown', onKey, true);
    target.removeEventListener('pointerdown', onPointer, true);
    if (refocus) button.focus();
  };
  function onKey(event: Event): void {
    const key = event as KeyboardEvent;
    if (key.key === 'Escape') {
      key.preventDefault();
      key.stopPropagation();
      close(true);
    } else if (key.key === 'ArrowDown' || key.key === 'ArrowUp') {
      key.preventDefault();
      const enabled = items().filter((el) => !el.disabled);
      const at = enabled.findIndex((el) => el === (card.getRootNode() as ShadowRoot).activeElement);
      const step = key.key === 'ArrowDown' ? 1 : enabled.length - 1;
      enabled[at < 0 ? 0 : (at + step) % enabled.length]?.focus();
    }
  }
  function onPointer(event: Event): void {
    const path = event.composedPath();
    if (menu && !path.includes(menu) && !path.includes(button)) close(false);
  }
  const open = (): void => {
    const root = doc.createElement('div');
    menu = root;
    root.className = 'pb-cm';
    root.setAttribute('role', 'menu');
    for (const item of ITEMS) {
      const el = doc.createElement('button');
      el.type = 'button';
      el.setAttribute('role', 'menuitem');
      if (item.scope === 'workspace') el.setAttribute('data-danger', '');
      const count = doc.createElement('span');
      count.className = 'pb-cm-count';
      el.append(doc.createTextNode(item.label), count);
      el.addEventListener('click', () => {
        close(false);
        o.pick(item.scope);
      });
      root.append(el);
    }
    // Absolute in the column flex panel: without a top it sits over the header.
    const head = card.querySelector('header') ?? (card.firstElementChild as HTMLElement | null);
    if (head) root.style.top = `${head.offsetTop + head.offsetHeight}px`;
    head?.after(root);
    refresh();
    card.addEventListener('keydown', onKey, true);
    target.addEventListener('pointerdown', onPointer, true);
    items()
      .find((el) => !el.disabled)
      ?.focus();
  };
  return { toggle: () => (menu ? close(false) : open()), refresh, close };
}

/** The ⋯ menu of the Inbox panel: clear actions with Undo and the workspace dialog. Returns its disposer. */
export function mountInboxMenu(opts: InboxMenuOptions): () => void {
  const { card, button, win } = opts;
  const doc = card.ownerDocument;
  const style = doc.createElement('style');
  style.setAttribute(STYLE, '');
  style.textContent = menuRules();
  card.append(style);

  const bar = createBar(card);
  let dialog: { close(): void } | undefined;
  let pending: { request: ClearRequest; timer: Timer } | undefined;
  let active: ClearPort | undefined;
  let token = 0;
  let disposed = false;
  const feed = createInboxFeed(win, () => popup.refresh());
  const rows = (): readonly ClearRow[] => feed.rows();

  const run = async (request: ClearRequest): Promise<void> => {
    const mine = ++token;
    const port = (active ??= clearOf(win));
    bar.show('Clearing…');
    const answer = await port?.send(request);
    if (disposed) return;
    if (mine === token) bar.flash(resultLine(answer));
    else if (!answer) bar.note();
  };
  const flush = (): void => {
    if (!pending) return;
    clearTimeout(pending.timer);
    const { request } = pending;
    pending = undefined;
    void run(request);
  };
  const begin = (scope: 'fixed' | 'tracker'): void => {
    flush();
    const n = clearCounts(rows())[scope];
    const noun = n === 1 ? 'comment' : 'comments';
    const what = scope === 'fixed' ? `fixed ${noun}` : `${noun} sent to a tracker`;
    const request: ClearRequest = { v: 1, scope };
    token++;
    const timer = setTimeout(() => {
      pending = undefined;
      void run(request);
    }, UNDO_MS);
    pending = { request, timer };
    bar.show(`Clearing ${n} ${what} in ${UNDO_MS / 1000} s`, () => {
      clearTimeout(timer);
      pending = undefined;
      bar.end();
    });
  };
  const closeDialog = (): void => {
    dialog?.close();
    dialog = undefined;
  };
  const workspace = (): void => {
    flush();
    dialog = openClearDialog({
      card,
      win,
      counts: clearCounts(rows()),
      onCancel: closeDialog,
      onConfirm: (settings) => {
        closeDialog();
        void run(
          settings ? { v: 1, scope: 'workspace', settings: true } : { v: 1, scope: 'workspace' },
        );
      },
    });
  };
  const popup = createPopup({
    card,
    button,
    target: win.document ?? doc,
    counts: () => clearCounts(rows()),
    available: () => clearOf(win) !== undefined,
    pick: (scope) => (scope === 'workspace' ? workspace() : begin(scope)),
  });
  const onButton = (): void => popup.toggle();
  button.addEventListener('click', onButton);

  return () => {
    if (disposed) return;
    flush();
    disposed = true;
    active?.cancel();
    closeDialog();
    popup.close(false);
    button.removeEventListener('click', onButton);
    feed.dispose();
    bar.hide();
    style.remove();
  };
}
