// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { menuRules } from './inbox-menu-styles';
import { mountInboxMenu } from './inbox-menu';

type Row = { id: string; status: string; comment: string; iterations: []; sentToTracker?: unknown };
const row = (status: string, extra: object = {}): Row => ({
  id: status + Math.random(),
  status,
  comment: 'c',
  iterations: [],
  ...extra,
});

function setup(opts: { caps?: string[]; rows?: Row[] } = {}) {
  document.body.replaceChildren();
  const handlers = new Map<string, ((data: unknown) => void)[]>();
  const hot = {
    send: vi.fn(),
    on: vi.fn((event: string, cb: (data: unknown) => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), cb]);
    }),
    off: vi.fn((event: string, cb: (data: unknown) => void) => {
      handlers.set(
        event,
        (handlers.get(event) ?? []).filter((h) => h !== cb),
      );
    }),
  };
  const emit = (event: string, data: unknown) => handlers.get(event)?.forEach((h) => h(data));
  const caps = opts.caps ?? ['list', 'clear'];
  (window as unknown as { __passback: object }).__passback = { hot, caps };
  const card = document.createElement('section');
  const head = document.createElement('header');
  const button = document.createElement('button');
  button.setAttribute('aria-label', 'Inbox menu');
  head.append(button);
  card.append(head);
  document.body.append(card);
  const dispose = mountInboxMenu({ card, button, win: window });
  const items = () => [...card.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  const item = (label: string) => items().find((el) => el.textContent?.startsWith(label));
  const bar = () => card.querySelector('[role="status"]');
  const items$ = (rows: Row[]) => emit('passback:items', { v: 1, items: rows });
  items$(opts.rows ?? []);
  const cleared = (scope: string, extra: object = {}) =>
    emit('passback:cleared', {
      v: 1,
      scope,
      comments: 3,
      attachments: 2,
      answers: 1,
      done: 4,
      settings: false,
      ...extra,
    });
  return { card, button, dispose, items, item, bar, hot, emit, items$, cleared };
}

const FIXED = [row('accepted'), row('verified'), row('proposed'), row('ack')];

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { __passback?: object }).__passback;
  document.body.replaceChildren();
});

describe('inbox menu', () => {
  it('opens a menu of three clear actions with counts and no number for a zero', () => {
    const s = setup({ rows: FIXED });
    expect(s.card.querySelector('[role="menu"]')).toBeNull();
    const head = s.card.querySelector('header') as HTMLElement;
    Object.defineProperty(head, 'offsetTop', { value: 1 });
    Object.defineProperty(head, 'offsetHeight', { value: 40 });
    s.button.click();
    expect(s.card.querySelector<HTMLElement>('[role="menu"]')?.style.top).toBe('41px');
    expect(s.items().map((el) => el.textContent)).toEqual([
      'Clear fixed2',
      'Clear sent to tracker',
      'Clear workspace…',
    ]);
    expect(s.items().map((el) => el.disabled)).toEqual([false, true, false]);
    s.items$([...FIXED, row('queued', { sentToTracker: { n: 1 } })]);
    expect(s.item('Clear sent to tracker')?.disabled).toBe(false);
    expect(s.item('Clear sent to tracker')?.textContent).toBe('Clear sent to tracker1');
    s.button.click();
    expect(s.card.querySelector('[role="menu"]')).toBeNull();
    s.dispose();
  });

  it('moves focus with arrows, closes on Esc and on an outside press', () => {
    const s = setup({ rows: FIXED });
    s.button.click();
    expect(document.activeElement).toBe(s.item('Clear fixed'));
    const key = (k: string) => {
      const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
      (document.activeElement ?? s.card).dispatchEvent(event);
      return event;
    };
    key('ArrowDown');
    expect(document.activeElement).toBe(s.item('Clear workspace'));
    key('ArrowUp');
    expect(document.activeElement).toBe(s.item('Clear fixed'));
    expect(key('Escape').defaultPrevented).toBe(true);
    expect(s.card.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(s.button);
    expect(key('Escape').defaultPrevented).toBe(false);
    s.button.click();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    expect(s.card.querySelector('[role="menu"]')).toBeNull();
    s.dispose();
  });

  it('disables the actions without the clear capability and says so', () => {
    const s = setup({ caps: ['list'], rows: FIXED });
    s.button.click();
    expect(s.items().every((el) => el.disabled)).toBe(true);
    expect(s.card.textContent).toContain('Clearing is not available in this setup.');
    s.item('Clear fixed')?.click();
    expect(s.hot.send).not.toHaveBeenCalledWith('passback:clear', expect.anything());
    s.dispose();
  });

  it('clears fixed comments only after the undo time and sends the fixed scope', () => {
    const s = setup({ rows: FIXED });
    s.button.click();
    s.item('Clear fixed')?.click();
    expect(s.card.querySelector('[role="menu"]')).toBeNull();
    expect(s.bar()?.textContent).toContain('Clearing 2 fixed comments in 5 s');
    vi.advanceTimersByTime(4999);
    expect(s.hot.send).not.toHaveBeenCalledWith('passback:clear', expect.anything());
    vi.advanceTimersByTime(1);
    expect(s.hot.send).toHaveBeenCalledWith('passback:clear', { v: 1, scope: 'fixed' });
    expect(s.bar()?.textContent).toBe('Clearing…');
    s.dispose();
  });

  it('cancels a pending clear with Undo and sends nothing', () => {
    const s = setup({ rows: [row('accepted')] });
    s.button.click();
    s.item('Clear fixed')?.click();
    expect(s.bar()?.textContent).toContain('Clearing 1 fixed comment in 5 s');
    s.bar()?.querySelector('button')?.click();
    expect(s.bar()).toBeNull();
    vi.advanceTimersByTime(10000);
    expect(s.hot.send).not.toHaveBeenCalledWith('passback:clear', expect.anything());
    expect(vi.getTimerCount()).toBe(0);
    s.dispose();
  });

  it('sends a pending clear at once when another starts or the panel closes', () => {
    const rows = [row('accepted'), row('x', { sentToTracker: 1 })];
    const s = setup({ rows });
    s.button.click();
    s.item('Clear fixed')?.click();
    s.button.click();
    s.item('Clear sent to tracker')?.click();
    expect(s.hot.send).toHaveBeenCalledWith('passback:clear', { v: 1, scope: 'fixed' });
    expect(s.bar()?.textContent).toContain('Clearing 1 comment sent to a tracker in 5 s');
    s.items$([row('x', { sentToTracker: 1 }), row('y', { sentToTracker: 2 })]);
    s.button.click();
    s.item('Clear sent to tracker')?.click();
    expect(s.bar()?.textContent).toContain('Clearing 2 comments sent to a tracker in 5 s');
    s.dispose();
    expect(s.hot.send).toHaveBeenCalledWith('passback:clear', { v: 1, scope: 'tracker' });
    expect(vi.getTimerCount()).toBe(0);
    expect(s.bar()).toBeNull();
  });

  it('shows the counts of the answer, or a failure line when no answer comes', () => {
    const s = setup({ rows: FIXED });
    s.button.click();
    s.item('Clear fixed')?.click();
    vi.advanceTimersByTime(5000);
    s.cleared('fixed');
    return Promise.resolve().then(async () => {
      await Promise.resolve();
      expect(s.bar()?.textContent).toBe('Cleared 3 comments.');
      vi.advanceTimersByTime(4000);
      expect(s.bar()).toBeNull();
      s.button.click();
      s.item('Clear fixed')?.click();
      await vi.advanceTimersByTimeAsync(5000 + 5000);
      expect(s.bar()?.textContent).toBe('Could not clear. Try again.');
      await vi.advanceTimersByTimeAsync(4000);
      expect(s.bar()).toBeNull();
      s.dispose();
    });
  });

  it('clears the workspace after the dialog with and without the settings', async () => {
    const s = setup({ rows: FIXED });
    const dialog = () => s.card.querySelector('[role="dialog"]');
    s.button.click();
    s.item('Clear workspace')?.click();
    expect(dialog()).not.toBeNull();
    expect(s.hot.send).not.toHaveBeenCalledWith('passback:clear', expect.anything());
    const confirm = () =>
      [...s.card.querySelectorAll('button')].find((b) => b.textContent === 'Clear workspace');
    confirm()?.click();
    expect(dialog()).toBeNull();
    expect(s.hot.send).toHaveBeenLastCalledWith('passback:clear', { v: 1, scope: 'workspace' });
    s.cleared('workspace', { comments: 12, attachments: 3, answers: 1, done: 4 });
    await vi.advanceTimersByTimeAsync(0);
    expect(s.bar()?.textContent).toBe(
      'Cleared 12 comments, 3 screenshots and recordings, 1 answer, 4 done.',
    );
    s.button.click();
    s.item('Clear workspace')?.click();
    (s.card.querySelector('input') as HTMLInputElement).checked = true;
    confirm()?.click();
    expect(s.hot.send).toHaveBeenLastCalledWith('passback:clear', {
      v: 1,
      scope: 'workspace',
      settings: true,
    });
    s.cleared('workspace', { settings: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(s.bar()?.textContent).toContain(
      'Settings deleted. Run passback init to set it up again.',
    );
    s.button.click();
    s.item('Clear workspace')?.click();
    confirm()?.click();
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.bar()?.textContent).toBe('Could not clear. Try again.');
    s.dispose();
  });

  it('writes no hex or rgb literal in its styles', () => {
    const text = menuRules();
    expect(text).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(text).not.toMatch(/rgba?\(/i);
    expect(text).toContain('var(--pb-color-bad)');
    expect(text).toContain('var(--pb-color-on-status)');
    expect(text).not.toMatch(/var\(--pb-[a-z-]+,/);
  });

  it('removes its nodes, styles, listeners and timers on dispose', () => {
    const s = setup({ rows: FIXED });
    const before = s.card.childNodes.length;
    expect(s.card.querySelector('style[data-pb-clear-style]')).not.toBeNull();
    s.button.click();
    s.item('Clear workspace')?.click();
    s.dispose();
    expect(s.card.querySelector('style[data-pb-clear-style]')).toBeNull();
    expect(s.card.querySelector('[role="dialog"], [role="menu"], [role="status"]')).toBeNull();
    expect(s.card.childNodes.length).toBe(before - 1);
    s.button.click();
    expect(s.card.querySelector('[role="menu"]')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    s.dispose();
  });
});
