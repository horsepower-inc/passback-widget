// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { inboxViewRules } from './inbox-view-styles';
import { mountInboxView } from './inbox-view';

type Cb = (data: unknown) => void;
const iso = (extra = {}) => ({
  iterations: [],
  createdAt: 't',
  route: '/',
  iteration: 1,
  ...extra,
});
const ROWS = [
  { id: 'n1', status: 'declined', comment: 'Needs one', ...iso() },
  { id: 'w1', status: 'ack', comment: 'Working one', ...iso() },
  { id: 'f1', status: 'proposed', comment: 'Fixed one', ...iso() },
  { id: 't1', status: 'new', comment: 'Parked one', parked: true, ...iso() },
];

function setup(opts: { site?: boolean; kept?: unknown[]; onOpen?: (id: string) => void } = {}) {
  const doc = document.implementation.createHTMLDocument('');
  if (opts.site) {
    const script = doc.createElement('script');
    script.setAttribute('data-passback-endpoint', 'https://x.test/ingest');
    doc.head.append(script);
  }
  // The shell's shape: the host holds the panel, whose header buttons sit beside the content.
  const host = doc.createElement('div');
  const panel = doc.createElement('section');
  const shut = doc.createElement('button');
  const content = doc.createElement('div');
  panel.append(shut, content);
  host.append(panel);
  doc.body.append(host);
  const handlers = new Map<string, Cb>();
  const hot = {
    send: vi.fn(),
    on: (event: string, cb: Cb) => void handlers.set(event, cb),
    off: vi.fn(),
  };
  const bag = { hot, caps: ['list'], kept: opts.kept };
  const win = { __passback: bag, navigator: { platform: 'Linux' } } as unknown as Window;
  const dispose = mountInboxView({ content, host, win, onOpen: opts.onOpen });
  const push = (items: unknown[], truncated = false) =>
    handlers.get('passback:items')?.({ v: 1, items, truncated });
  const key = (k: string, init: KeyboardEventInit = {}, target: Element = content) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }));
  const tabs = () => [...content.querySelectorAll<HTMLElement>('[role="tab"]')];
  const rows = () => [...content.querySelectorAll<HTMLElement>('[role="option"]')];
  const selectedTab = () =>
    tabs().find((t) => t.getAttribute('aria-selected') === 'true')?.dataset.key;
  const focused = () => doc.activeElement ?? content;
  return { doc, host, shut, content, bag, push, key, tabs, rows, selectedTab, focused, dispose };
}
const kept = (comment: string, n?: number, act = vi.fn()) => ({ n, comment, locked: false, act });

describe('inbox view', () => {
  it('shows one tab row with a count after each label, none for a zero, and the Needs you count apart', () => {
    const { content, push, tabs } = setup({ site: true, kept: [kept('a', 1)] });
    expect(content.querySelector('[role="tablist"]')).not.toBeNull();
    expect(tabs().map((t) => t.textContent)).toEqual([
      'All1',
      'Needs you',
      'To send1',
      'Working',
      'Fixed',
      'Tracker',
    ]);
    push(ROWS);
    expect(tabs().map((t) => t.textContent)).toEqual([
      'All5',
      'Needs you1',
      'To send1',
      'Working1',
      'Fixed1',
      'Tracker1',
    ]);
    const marked = content.querySelectorAll('.pb-iv-count[data-needs]');
    expect(marked).toHaveLength(1);
    expect(marked[0]?.closest('[role="tab"]')?.getAttribute('data-key')).toBe('needs');
  });

  it('hides the Tracker tab on a page without a site', () => {
    const none = setup();
    none.push(ROWS);
    expect(none.tabs().map((t) => t.textContent)).not.toContain('Tracker');
    expect(none.content.textContent).not.toContain('Parked one');
    expect(none.tabs()[0]?.textContent).toBe('All3');
    expect(
      setup({ site: true })
        .tabs()
        .map((t) => t.dataset.key),
    ).toContain('tracker');
  });

  it('lists the chosen section and groups every comment under headings in All', () => {
    const { content, push, tabs, rows } = setup({ site: true, kept: [kept('Kept one', 1)] });
    push(ROWS);
    const groups = [...content.querySelectorAll('.pb-iv-group')].map((g) => g.textContent);
    expect(groups).toEqual(['Needs you 1', 'To send 1', 'Working 1', 'Fixed 1', 'Tracker 1']);
    expect(rows().map((r) => r.querySelector('.pb-iv-comment')?.textContent)).toEqual([
      'Needs one',
      'Kept one',
      'Working one',
      'Fixed one',
      'Parked one',
    ]);
    tabs()[3]?.click();
    expect(rows()).toHaveLength(1);
    expect(content.querySelectorAll('.pb-iv-group')).toHaveLength(0);
    expect(rows()[0]?.textContent).toContain('Working one');
    push([]);
    tabs()[4]?.click();
    expect(content.querySelector('.pb-iv-list')?.textContent).toBe('Nothing here.');
    push([], true);
    expect(content.querySelector('.pb-iv-list')?.textContent).toMatch(/newest comments/);
  });

  it('shows the mark number of a kept comment and the state line of every row', () => {
    const { push, rows } = setup({ site: true, kept: [kept('Kept one', 3)] });
    push(ROWS);
    const parts = rows().map((r) => [
      r.querySelector('.pb-iv-n')?.textContent,
      r.querySelector('.pb-iv-line')?.textContent,
      r.hasAttribute('data-muted'),
    ]);
    expect(parts).toEqual([
      ['', 'The agent declined this comment', false],
      ['3', 'Not sent yet', false],
      ['', 'The agent is working', false],
      ['', 'Fixed', true],
      ['', 'Parked for the tracker', true],
    ]);
    expect(rows()[1]?.querySelector('.pb-iv-act')?.textContent).toBe('Delete');
    expect(rows()[0]?.querySelector('.pb-iv-act')?.textContent).toBe('Open');
  });

  it('switches tabs with the keys 1 to 6 and moves the selection with the arrow keys', () => {
    const { content, shut, push, key, selectedTab, rows, focused } = setup({ site: true });
    push(ROWS);
    key('2');
    expect(selectedTab()).toBe('needs');
    shut.focus();
    key('4', {}, shut);
    expect(selectedTab()).toBe('working');
    key('6');
    expect(selectedTab()).toBe('tracker');
    key('1');
    expect(selectedTab()).toBe('all');
    const sel = () => rows().findIndex((r) => r.getAttribute('aria-selected') === 'true');
    expect(sel()).toBe(0);
    key('ArrowDown');
    key('ArrowDown');
    expect(sel()).toBe(2);
    key('ArrowUp');
    expect(sel()).toBe(1);
    expect(focused()).toBe(rows()[1]);
    for (let i = 0; i < 9; i++) key('ArrowDown');
    expect(sel()).toBe(3);
    const field = content.ownerDocument.createElement('input');
    content.append(field);
    key('2', {}, field);
    expect(selectedTab()).toBe('all');
    const bare = setup();
    bare.key('6');
    expect(bare.selectedTab()).toBe('all');
    bare.key('5');
    expect(bare.selectedTab()).toBe('fixed');
  });

  it('opens an inbox row with Enter or a click and a kept comment with neither', () => {
    const onOpen = vi.fn();
    const { push, key, rows, tabs, focused } = setup({ kept: [kept('Kept one', 1)], onOpen });
    push(ROWS);
    key('Enter');
    expect(onOpen).toHaveBeenLastCalledWith('n1');
    key('Escape');
    tabs()[0]?.focus();
    key('ArrowDown', {}, focused());
    key('Enter', {}, focused());
    rows()[1]?.click();
    expect(onOpen).toHaveBeenCalledTimes(1);
    key('ArrowDown', {}, focused());
    key('Enter', {}, focused());
    expect(onOpen).toHaveBeenLastCalledWith('w1');
    key('Escape');
    rows()[0]?.focus();
    key('Enter', {}, focused());
    expect(onOpen).toHaveBeenLastCalledWith('n1');
    expect(onOpen).toHaveBeenCalledTimes(3);
    key('Escape');
    onOpen.mockClear();
    rows()[2]?.click();
    expect(onOpen).toHaveBeenLastCalledWith('w1');
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('sends the kept comments to the agent from the footer button and from the key', () => {
    const act = vi.fn();
    const { host, shut, content, key, bag } = setup({ kept: [kept('a', 1, act), kept('b', 2)] });
    const sent = vi.fn();
    host.addEventListener('passback:send-all', sent);
    const button = content.querySelector<HTMLButtonElement>('.pb-iv-send');
    expect(button?.textContent).toContain('Send 2 to agent');
    expect(button?.textContent).toContain('Ctrl+Enter');
    expect(content.querySelector('.pb-iv-total')?.textContent).toBe('2 comments');
    button?.click();
    expect(sent).toHaveBeenCalledTimes(1);
    key('Enter', { ctrlKey: true });
    expect(sent).toHaveBeenCalledTimes(2);
    const field = content.ownerDocument.createElement('textarea');
    content.append(field);
    key('Enter', { ctrlKey: true }, field);
    key('Enter', { metaKey: true }, field);
    expect(sent).toHaveBeenCalledTimes(2);
    key('Enter', { ctrlKey: true }, shut);
    expect(sent).toHaveBeenCalledTimes(3);
    content.querySelector<HTMLButtonElement>('.pb-iv-act')?.click();
    expect(act).toHaveBeenCalledWith('delete');
    bag.kept = [];
    host.dispatchEvent(new Event('passback:sync'));
    expect(content.querySelector<HTMLButtonElement>('.pb-iv-send')?.disabled).toBe(true);
    key('Enter', { ctrlKey: true });
    expect(sent).toHaveBeenCalledTimes(3);
  });

  it('files the tracker comments from the footer button and from Ctrl+Shift+Enter and sends the others to the agent', () => {
    const acts = [vi.fn(), vi.fn(), vi.fn()];
    const rows = [
      { ...kept('a', 1, acts[0]) },
      { ...kept('b', 2, acts[1]), dest: 'tracker' },
      { ...kept('c', 3, acts[2]), dest: 'tracker' },
    ];
    const { host, content, key, bag } = setup({ site: true, kept: rows });
    (bag as { relay?: () => unknown }).relay = () => ({
      subscription: 'active',
      tracker: 'Linear',
    });
    host.dispatchEvent(new Event('passback:sync'));
    const sent: unknown[] = [];
    host.addEventListener('passback:send-all', (e) => sent.push((e as CustomEvent).detail));
    const file = content.querySelector<HTMLButtonElement>('.pb-iv-file');
    expect(file?.textContent).toBe('File 2 in Linear Ctrl+Shift+Enter');
    expect(content.querySelector('.pb-iv-send')?.textContent).toContain('Send 1 to agent');
    file?.click();
    key('Enter', { ctrlKey: true, shiftKey: true });
    key('Enter', { ctrlKey: true });
    content.querySelector<HTMLButtonElement>('.pb-iv-send')?.click();
    expect(sent).toEqual([
      { dest: 'tracker' },
      { dest: 'tracker' },
      { dest: 'agent' },
      { dest: 'agent' },
    ]);
    const halves = content.querySelectorAll<HTMLButtonElement>('.pb-iv-dest-btn');
    halves[1]?.click();
    halves[2]?.click();
    expect(acts[0]).toHaveBeenCalledWith('to-tracker');
    expect(acts[1]).toHaveBeenCalledWith('to-agent');
    bag.kept = [rows[0]!];
    (bag as { relay?: () => unknown }).relay = () => ({ subscription: 'none' });
    host.dispatchEvent(new Event('passback:sync'));
    expect(content.querySelector('.pb-iv-file')?.textContent).toBe('Connect a tracker');
    key('Enter', { ctrlKey: true, shiftKey: true });
    expect(sent).toHaveLength(4);
  });

  it('renders again when the feed changes and when the kept list changes', () => {
    const { host, content, push, bag } = setup();
    expect(content.textContent).toContain('Nothing here.');
    push(ROWS);
    expect(content.textContent).toContain('Working one');
    bag.kept = [kept('Fresh', 1)];
    expect(content.textContent).not.toContain('Fresh');
    host.dispatchEvent(new Event('passback:sync'));
    expect(content.textContent).toContain('Fresh');
  });

  it('removes its nodes and listeners on dispose', () => {
    const { host, content, push, key, bag, dispose } = setup({ kept: [kept('a', 1)] });
    const sent = vi.fn();
    host.addEventListener('passback:send-all', sent);
    dispose();
    dispose();
    expect(content.childNodes).toHaveLength(0);
    expect((bag.hot.off as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    push(ROWS);
    host.dispatchEvent(new Event('passback:sync'));
    key('Enter', { ctrlKey: true });
    expect(content.childNodes).toHaveLength(0);
    expect(sent).not.toHaveBeenCalled();
  });

  it('writes no hex or rgb literal in its styles', () => {
    const text = inboxViewRules();
    expect(text).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(text).not.toMatch(/rgba?\(/i);
    expect(text).toContain('var(--pb-color-ask)');
    expect(text).toContain('height: 34px');
    expect(text).not.toMatch(/var\(--pb-[a-z-]+,/);
  });

  it('opens the task of an inbox row in place of the list and returns to the same tab and selection', () => {
    const onOpen = vi.fn();
    const { content, push, tabs, rows, key, selectedTab } = setup({ onOpen });
    push(ROWS);
    tabs()
      .find((t) => t.dataset.key === 'working')
      ?.click();
    expect(selectedTab()).toBe('working');
    rows()[0]?.click();
    expect(onOpen).toHaveBeenCalledWith('w1');
    expect(content.querySelector('.pb-it-name')?.textContent).toBe('Working one');
    expect(content.querySelector('[role="tablist"]')).toBeNull();
    expect(rows()).toHaveLength(0);
    key('Escape');
    expect(content.querySelector('.pb-it')).toBeNull();
    expect(selectedTab()).toBe('working');
    expect(rows()).toHaveLength(1);
  });

  it('shows the list number on each inbox row and the continued number on a kept row', () => {
    const { content, bag, push, rows } = setup({ kept: [kept('Mine', 3)] });
    const ids = ['n1', 'w1'];
    Object.assign(bag, {
      inbox: {
        rows: () => ids.map((id) => ({ id })),
        numberOf: (id: string) => ids.indexOf(id) + 1 || undefined,
        subscribe: vi.fn(),
      },
    });
    push(ROWS);
    const numbers = () => rows().map((r) => r.querySelector('.pb-iv-n')?.textContent);
    expect(numbers()).toEqual(['1', '3', '2', '']);
    expect(content.querySelectorAll('.pb-iv-n')).toHaveLength(4);
  });

  it('dispatches passback:highlight for a hovered inbox row and for the open task and clears it on close', () => {
    const { host, push, rows, key, dispose } = setup({ kept: [kept('k')] });
    const ids: unknown[] = [];
    host.addEventListener('passback:highlight', (e) => ids.push((e as CustomEvent).detail.id));
    push(ROWS);
    const keptRow = rows().find((r) => r.dataset.key === 'k0');
    const inbox = rows().find((r) => r.dataset.key !== 'k0');
    keptRow?.dispatchEvent(new Event('pointerenter'));
    keptRow?.dispatchEvent(new Event('pointerleave'));
    expect(ids).toEqual([]);
    inbox?.dispatchEvent(new Event('pointerenter'));
    expect(ids).toEqual([inbox?.dataset.key]);
    inbox?.dispatchEvent(new Event('pointerleave'));
    expect(ids).toEqual([inbox?.dataset.key, null]);
    inbox?.click();
    expect(ids).toEqual([inbox?.dataset.key, null, inbox?.dataset.key]);
    key('Escape');
    expect(ids.at(-1)).toBeNull();
    inbox?.click();
    dispose();
    expect(ids.at(-1)).toBeNull();
    expect(ids).toHaveLength(6);
  });
});
