// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountInboxMenu } from './inbox-menu';

const SENTENCE = 'An earlier clear failed.';
const rows = [
  { id: 'a', status: 'accepted', comment: 'c', iterations: [] },
  { id: 'b', status: 'x', comment: 'c', iterations: [], sentToTracker: 1 },
];
const answer = { v: 1, comments: 3, attachments: 0, answers: 0, done: 0, settings: false };

function setup() {
  document.body.replaceChildren();
  const handlers = new Map<string, ((data: unknown) => void)[]>();
  const hot = {
    send: vi.fn(),
    on: vi.fn((e: string, cb: (data: unknown) => void) => {
      handlers.set(e, [...(handlers.get(e) ?? []), cb]);
    }),
    off: vi.fn(),
  };
  const emit = (e: string, data: unknown) => handlers.get(e)?.forEach((h) => h(data));
  (window as unknown as { __passback: object }).__passback = { hot, caps: ['list', 'clear'] };
  const card = document.createElement('section');
  const button = document.createElement('button');
  card.append(button);
  document.body.append(card);
  const dispose = mountInboxMenu({ card, button, win: window });
  const bar = () => card.querySelector('[role="status"]');
  const text = () => bar()?.querySelector('span')?.textContent;
  const undo = () => bar()?.querySelector('button') ?? null;
  const pick = (label: string) => {
    button.click();
    [...card.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((el) => el.textContent?.startsWith(label))
      ?.click();
  };
  emit('passback:items', { v: 1, items: rows });
  const cleared = (scope: string) => emit('passback:cleared', { ...answer, scope });
  const sent = (scope: string) =>
    hot.send.mock.calls.filter((c) => c[0] === 'passback:clear' && c[1].scope === scope).length;
  return { dispose, bar, text, undo, pick, cleared, sent };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { __passback?: object }).__passback;
  document.body.replaceChildren();
});

describe('inbox menu, an earlier clear that failed', () => {
  it('keeps the failure of an earlier clear in front of the next clear and of its result', async () => {
    const s = setup();
    s.pick('Clear fixed');
    s.pick('Clear sent to tracker');
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.bar()?.textContent).toBe(`${SENTENCE} Clearing…`);
    s.cleared('tracker');
    await vi.advanceTimersByTimeAsync(0);
    expect(s.bar()?.textContent).toBe(`${SENTENCE} Cleared 3 comments.`);
    await vi.advanceTimersByTimeAsync(4000);
    expect(s.bar()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    s.dispose();
  });

  it('does not let a late success of an earlier clear replace the countdown and its Undo', async () => {
    const s = setup();
    s.pick('Clear fixed');
    s.pick('Clear sent to tracker');
    s.cleared('fixed');
    await vi.advanceTimersByTimeAsync(0);
    expect(s.text()).toContain('Clearing 1 comment sent to a tracker in 5 s');
    expect(s.undo()).not.toBeNull();
    s.undo()?.click();
    await vi.advanceTimersByTimeAsync(10000);
    expect(s.sent('tracker')).toBe(0);
    s.dispose();
  });

  it('keeps keyboard focus on Undo when an earlier clear fails during the countdown', async () => {
    const s = setup();
    s.pick('Clear fixed');
    s.pick('Clear sent to tracker');
    await vi.advanceTimersByTimeAsync(2000);
    // The third clear sends the tracker one, which cuts the first clear's wait; its countdown runs on.
    s.pick('Clear fixed');
    const before = s.undo();
    before?.focus();
    expect(document.activeElement).toBe(before);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.text()).toMatch(new RegExp(`^${SENTENCE} Clearing 1 fixed comment in 5 s`));
    expect([s.undo() === before, document.activeElement === before]).toEqual([true, true]);
    expect(s.sent('fixed')).toBe(1);
    (document.activeElement as HTMLButtonElement).click();
    expect(s.bar()?.textContent).toBe(SENTENCE);
    await vi.advanceTimersByTimeAsync(10000);
    expect([s.sent('fixed'), s.bar()]).toEqual([1, null]);
    s.dispose();
  });

  it('shows the earlier failure alone when the newer clear is undone', async () => {
    const s = setup();
    s.pick('Clear fixed');
    s.pick('Clear sent to tracker');
    await vi.advanceTimersByTimeAsync(2000);
    s.pick('Clear fixed');
    await vi.advanceTimersByTimeAsync(0);
    expect(s.text()).toMatch(new RegExp(`^${SENTENCE} Clearing 1 fixed comment in 5 s`));
    expect(s.undo()).not.toBeNull();
    s.cleared('tracker');
    await vi.advanceTimersByTimeAsync(0);
    s.undo()?.click();
    expect(s.bar()?.textContent).toBe(SENTENCE);
    expect(s.undo()).toBeNull();
    expect(s.sent('fixed')).toBe(1);
    await vi.advanceTimersByTimeAsync(4000);
    expect(s.bar()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    s.pick('Clear fixed');
    s.pick('Clear sent to tracker');
    s.undo()?.click();
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.bar()?.textContent).toBe(SENTENCE);
    s.dispose();
    expect([s.bar(), vi.getTimerCount()]).toEqual([null, 0]);
  });
});
