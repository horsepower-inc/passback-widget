// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createInboxStore } from './inbox-store';
import { openInboxPanel } from './inbox-panel';

const ANCHOR = { top: 600, right: 960, bottom: 640, left: 700, width: 260, height: 40 };
const SINCE = '2026-01-01T00:00:00.000Z';
const waiting = { state: 'waiting', agent: 'claude-code', since: SINCE };

type Cb = (data: unknown) => void;
function setup(caps: unknown = ['list'], channel = true) {
  const handlers = new Map<string, Cb>();
  const hot = {
    send: vi.fn(),
    on: vi.fn((event: string, cb: Cb) => void handlers.set(event, cb)),
    off: vi.fn((event: string) => void handlers.delete(event)),
  };
  const win = {
    innerWidth: 1000,
    innerHeight: 800,
    __passback: channel ? { hot, caps } : undefined,
  } as unknown as Window;
  const doc = document.implementation.createHTMLDocument('');
  const host = doc.createElement('div');
  doc.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  const anchor = doc.createElement('div');
  root.append(anchor);
  anchor.getBoundingClientRect = () => ANCHOR as DOMRect;
  const push = (data: unknown) => handlers.get('passback:items')?.(data);
  const open = () => openInboxPanel({ root, win, anchor });
  return { hot, win, root, push, open };
}
const line = (root: ShadowRoot) => root.querySelector<HTMLElement>('[role="status"]');

describe('inbox panel agent feed', () => {
  it('shows the agent line from the snapshot the dev server pushes and follows later snapshots', () => {
    const { root, push, open } = setup();
    open();
    push({ v: 1, items: [], agent: waiting });
    const node = line(root);
    expect(node?.textContent).toBe('Claude Code waiting');
    push({ v: 1, items: [], agent: { ...waiting, state: 'working', background: true } });
    expect(line(root)).toBe(node);
    expect(node?.textContent).toBe('Claude Code working (background)');
    push({ v: 1, items: [], agent: { state: 'absent' } });
    expect(line(root)?.textContent).toBe('No agent session: type /passback');
    push({ v: 1, items: [], agent: { state: 'absent' } });
    expect(root.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it('shows no agent line for a snapshot without an agent or with a malformed one', () => {
    const { root, push, open } = setup();
    open();
    push({ v: 1, items: [] });
    expect(line(root)).toBeNull();
    push({ v: 1, items: [], agent: waiting });
    expect(line(root)).not.toBeNull();
    push({ v: 1, items: [] });
    expect(line(root)).toBeNull();
    push({ v: 1, items: [], agent: 'x' });
    expect(line(root)).toBeNull();
    push({ v: 1, items: [], agent: { state: 'waiting', since: SINCE } });
    expect(line(root)).toBeNull();
  });

  it('reads the agent through the window inbox store when the panel opens after the snapshot', () => {
    const { hot, win, root, push, open } = setup();
    createInboxStore(win);
    push({ v: 1, items: [], agent: waiting });
    open();
    expect(line(root)?.textContent).toBe('Claude Code waiting');
    expect(hot.send).toHaveBeenCalledTimes(1);
  });

  it('shows no agent line and does not throw without a channel or without the list capability', () => {
    for (const [caps, channel] of [
      [[], true],
      [null, true],
      [['list'], false],
    ] as const) {
      const { hot, root, push, open } = setup(caps, channel);
      expect(() => open()).not.toThrow();
      push({ v: 1, items: [], agent: waiting });
      expect(line(root)).toBeNull();
      expect(hot.on).not.toHaveBeenCalled();
      expect(hot.send).not.toHaveBeenCalled();
    }
  });

  it('stops following snapshots after the panel closes', () => {
    const { root, push, open } = setup();
    open()?.close();
    expect(() => push({ v: 1, items: [], agent: waiting })).not.toThrow();
    expect(line(root)).toBeNull();
  });
});
