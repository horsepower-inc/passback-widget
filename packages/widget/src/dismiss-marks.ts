import type { TrackedMark } from './overlay-reattach';
import type { ReopenPort } from './reopen';
import { CLASS } from './styles';

export type DismissCtx = {
  root: ShadowRoot;
  host: HTMLElement;
  launcher: { update(marks: readonly TrackedMark[]): void };
  state: { marks: TrackedMark[] };
  reopen?: ReopenPort;
};

/** fly 420 ms + stamp 1800 ms, the Celebration lifetime: the pin leaves with the stamp. */
export const FIXED_CLEAR_MS = 2220;
const RULES = `
.${CLASS.bubble} button[part='dismiss'] { position: absolute; top: 0; right: 0; min-width: 24px; min-height: 24px; padding: 0; border: 0; background: transparent; color: var(--pb-color-text); font: inherit; line-height: 1; cursor: pointer; }
.pb-palette button[data-act='clear-sent'][hidden] { display: none; }
`;

function clearButton(doc: Document): HTMLButtonElement {
  const clear = doc.createElement('button');
  clear.type = 'button';
  clear.textContent = '×';
  clear.title = 'Clear sent';
  clear.setAttribute('aria-label', 'Clear sent');
  clear.dataset.act = 'clear-sent';
  clear.style.setProperty('--pb-i', '1');
  clear.hidden = true;
  return clear;
}

function addDismiss(doc: Document, mark: TrackedMark, onClick: () => void): void {
  if (mark.bubble.element.querySelector("button[part='dismiss']")) return;
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = '×';
  button.setAttribute('part', 'dismiss');
  button.setAttribute('aria-label', 'Dismiss');
  button.addEventListener('click', onClick);
  mark.bubble.element.append(button);
}

function addStyle(doc: Document, root: ShadowRoot): HTMLStyleElement {
  const style = doc.createElement('style');
  style.setAttribute('data-pb-dismiss-styles', '');
  style.textContent = RULES;
  root.append(style);
  return style;
}

function clearsItself(mark: TrackedMark, reopen: ReopenPort | undefined): boolean {
  return mark.lastState === 'sent' || (mark.lastState === 'done' && reopen === undefined);
}

/** Collector-chunk add-on: a Fixed mark clears itself (kept where a reopen port exists), a Sent mark gets Dismiss and Clear sent; display only. */
export function dismissMarks({ root, host, launcher, state, reopen }: DismissCtx): void {
  const sent = (mark: TrackedMark): boolean =>
    mark.id !== undefined &&
    (mark.lastState === 'sent' || (reopen !== undefined && mark.lastState === 'done'));
  const doc = root.ownerDocument;
  const style = addStyle(doc, root);
  const timers = new Map<TrackedMark, ReturnType<typeof setTimeout>>();
  const clear = clearButton(doc);
  root.querySelector<HTMLElement>('.pb-palette')?.append(clear);
  const drop = (mark: TrackedMark): void => {
    clearTimeout(timers.get(mark));
    timers.delete(mark);
    state.marks = state.marks.filter((candidate) => candidate !== mark);
    mark.dot.remove();
    mark.bubble.destroy();
    launcher.update(state.marks);
    sync();
  };
  const clears = (mark: TrackedMark): boolean => clearsItself(mark, reopen);
  const track = (mark: TrackedMark): void => {
    if (clears(mark) && !timers.has(mark))
      timers.set(
        mark,
        setTimeout(() => drop(mark), FIXED_CLEAR_MS),
      );
    if (sent(mark)) addDismiss(doc, mark, () => drop(mark));
  };
  function sync(): void {
    for (const [mark, timer] of timers) {
      if (state.marks.includes(mark) && clears(mark)) continue;
      clearTimeout(timer);
      timers.delete(mark);
    }
    state.marks.forEach(track);
    clear.hidden = !state.marks.some(sent);
  }
  const clearSent = (): void => state.marks.filter(sent).forEach(drop);
  const dispose = (): void => {
    timers.forEach((timer) => clearTimeout(timer));
    timers.clear();
    host.removeEventListener('passback:sync', sync);
    host.removeEventListener('passback:dispose', dispose);
    clear.remove();
    style.remove();
  };
  clear.addEventListener('click', clearSent);
  host.addEventListener('passback:sync', sync);
  host.addEventListener('passback:dispose', dispose);
  sync();
}
