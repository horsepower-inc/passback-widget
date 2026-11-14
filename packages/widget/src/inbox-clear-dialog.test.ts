// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openClearDialog } from './inbox-clear-dialog';

const COUNTS = { comments: 12, fixed: 3, tracker: 0, working: 2 };

const open: { close(): void }[] = [];

function setup(counts = COUNTS) {
  document.body.replaceChildren();
  const card = document.createElement('section');
  const menu = document.createElement('button');
  menu.setAttribute('aria-label', 'Inbox menu');
  card.append(menu);
  document.body.append(card);
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const dialog = openClearDialog({ card, win: window, counts, onConfirm, onCancel });
  open.push(dialog);
  const q = (sel: string) => card.querySelector<HTMLElement>(sel);
  const buttons = () => [...card.querySelectorAll('button')].filter((b) => b !== menu);
  const key = (init: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    document.dispatchEvent(event);
    return event;
  };
  return { card, menu, dialog, onConfirm, onCancel, q, buttons, key };
}

afterEach(() => {
  for (const dialog of open.splice(0)) dialog.close();
  document.body.replaceChildren();
});

describe('clear workspace dialog', () => {
  it('shows the counts, the tracker line and the exact settings checkbox text', () => {
    const { q } = setup();
    const dialog = q('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-label')).toBe('Clear workspace');
    const text = dialog?.textContent ?? '';
    expect(text).toContain(
      "This removes 12 comments with their screenshots and recordings, the agent's answers and the done folder.",
    );
    expect(text).toContain('Issues already filed in a tracker stay in the tracker.');
    expect(q('label')?.textContent).toBe(
      'Also delete the settings: the whole .passback/ folder. Run passback init to set it up again.',
    );
  });

  it('shows the working note only while the settings box is unticked', () => {
    const { q } = setup();
    const note = 'The agent is told to stop on its next wait.';
    expect(q('[role="dialog"]')?.textContent).toContain(`2 comments are being worked on. ${note}`);
    const box = q('input') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(q('[role="dialog"]')?.textContent).not.toContain('being worked on');
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(q('[role="dialog"]')?.textContent).toContain('being worked on');
    const quiet = setup({ ...COUNTS, working: 0 });
    expect(quiet.q('[role="dialog"]')?.textContent).not.toContain('being worked on');
  });

  it('starts on Cancel and keeps Tab and Shift+Tab inside the dialog', () => {
    const { q, buttons, key } = setup();
    const [cancel, confirm] = buttons();
    const box = q('input') as HTMLElement;
    expect(document.activeElement).toBe(cancel);
    expect(key({ key: 'Tab' }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(confirm);
    key({ key: 'Tab' });
    expect(document.activeElement).toBe(box);
    key({ key: 'Tab' });
    expect(document.activeElement).toBe(cancel);
    key({ key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(box);
    key({ key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  it('cancels with Esc and consumes the key', () => {
    const { key, onCancel } = setup();
    const later = vi.fn();
    document.addEventListener('keydown', later);
    const event = key({ key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(later).not.toHaveBeenCalled();
    document.removeEventListener('keydown', later);
  });

  it('confirms with the settings choice and returns focus on close', () => {
    const first = setup();
    first.buttons()[1]?.click();
    expect(first.onConfirm).toHaveBeenLastCalledWith(false);
    first.dialog.close();
    expect(first.q('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(first.menu);
    first.key({ key: 'Escape' });
    expect(first.onCancel).not.toHaveBeenCalled();

    const second = setup();
    const box = second.q('input') as HTMLInputElement;
    box.checked = true;
    second.buttons()[1]?.click();
    expect(second.onConfirm).toHaveBeenLastCalledWith(true);
    second.buttons()[0]?.click();
    expect(second.onCancel).toHaveBeenCalledTimes(1);
  });
});
