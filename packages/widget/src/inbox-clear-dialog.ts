import type { ClearCounts } from './inbox-clear';

export type ClearDialogOptions = {
  card: HTMLElement;
  win: Window;
  counts: ClearCounts;
  onConfirm(settings: boolean): void;
  onCancel(): void;
};

const comments = (n: number): string => `${n} ${n === 1 ? 'comment' : 'comments'}`;

/** The confirm dialog of Clear workspace: focus trapped, Esc cancels, nothing is sent from here. */
export function openClearDialog(opts: ClearDialogOptions): { close(): void } {
  const { card, win, counts, onConfirm, onCancel } = opts;
  const doc = card.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => {
    const node = doc.createElement(tag);
    node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const backdrop = el('div', 'pb-cd');
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', 'Clear workspace');
  const box = el('div', 'pb-cd-box');
  const lead = el(
    'p',
    'pb-cd-line',
    `This removes ${comments(counts.comments)} with their screenshots and recordings, the agent's answers and the done folder.`,
  );
  const note = el(
    'p',
    'pb-cd-line pb-cd-note',
    `${comments(counts.working)} ${counts.working === 1 ? 'is' : 'are'} being worked on. The agent is told to stop on its next wait.`,
  );
  const label = el('label', 'pb-cd-check');
  const box2 = doc.createElement('input');
  box2.type = 'checkbox';
  label.append(
    box2,
    doc.createTextNode(
      'Also delete the settings: the whole .passback/ folder. Run passback init to set it up again.',
    ),
  );
  const tracker = el('p', 'pb-cd-line', 'Issues already filed in a tracker stay in the tracker.');
  const actions = el('div', 'pb-cd-actions');
  const cancel = el('button', 'pb-cd-cancel', 'Cancel');
  const confirm = el('button', 'pb-cd-confirm', 'Clear workspace');
  cancel.type = confirm.type = 'button';
  actions.append(cancel, confirm);
  box.append(lead, label, tracker, actions);
  const syncNote = (): void => {
    if (box2.checked || counts.working <= 0) note.remove();
    else lead.after(note);
  };
  syncNote();
  backdrop.append(box);
  card.append(backdrop);
  cancel.focus();

  const stops = [box2, cancel, confirm];
  const active = (): Element | null => (card.getRootNode() as Document | ShadowRoot).activeElement;
  const keys = (event: Event): void => {
    const key = event as KeyboardEvent;
    if (key.key === 'Escape') {
      key.preventDefault();
      key.stopImmediatePropagation();
      onCancel();
    } else if (key.key === 'Tab') {
      key.preventDefault();
      const at = stops.findIndex((stop) => stop === active());
      const next = at < 0 ? 1 : (at + (key.shiftKey ? stops.length - 1 : 1)) % stops.length;
      stops[next]?.focus();
    }
  };
  const target = win.document ?? doc;
  target.addEventListener('keydown', keys, true);
  box2.addEventListener('change', syncNote);
  cancel.addEventListener('click', () => onCancel());
  confirm.addEventListener('click', () => onConfirm(box2.checked));

  let closed = false;
  return {
    close() {
      if (closed) return;
      closed = true;
      target.removeEventListener('keydown', keys, true);
      backdrop.remove();
      card.querySelector<HTMLElement>('button[aria-label="Inbox menu"]')?.focus();
    },
  };
}
