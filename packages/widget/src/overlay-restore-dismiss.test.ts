// @vitest-environment happy-dom
import type { ResolveTarget } from '@passback/collectors';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXED_CLEAR_MS, dismissMarks } from './dismiss-marks';
import type { RestoreEntry } from './inbox-restore';
import { createOverlay, type Overlay } from './overlay';
import type { TrackedMark } from './overlay-reattach';
import { palette } from './palette';
import { CLASS } from './styles';

const TARGET = { selectors: [], tag: 'p', text: 'x' } as unknown as ResolveTarget;
const scope = globalThis as { __passback?: unknown };
const overlays: Overlay[] = [];
const el = (tag: string) => document.body.appendChild(document.createElement(tag));

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  overlays.splice(0).forEach((overlay) => overlay.destroy());
  delete scope.__passback;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

function setup(withPort: boolean) {
  scope.__passback = { fx: { addons: [palette, dismissMarks] } };
  const host = el('div');
  const root = host.attachShadow({ mode: 'open' });
  const overlay = createOverlay({
    doc: document,
    root,
    host,
    selectorOf: () => 'p',
    targetOf: () => TARGET,
    onSubmit: vi.fn(),
    reopen: withPort ? { send: vi.fn(async () => true) } : undefined,
  });
  overlays.push(overlay);
  return { root, overlay };
}
const done = { target: TARGET, state: 'done' } as const;
const entry = (id: string, n: number): RestoreEntry => ({ id, n, ...done, element: el('p') });
const dots = (r: ShadowRoot) => [...r.querySelectorAll<HTMLElement>("[role='img'][data-state]")];
const shown = (root: ShadowRoot) => dots(root).map((d) => [d.textContent, d.dataset.state]);
const dismiss = (root: ShadowRoot) =>
  root.querySelector<HTMLButtonElement>("button[part='dismiss']")!.click();
function sendHere(root: ShadowRoot, overlay: Overlay, id: string): void {
  const opts = { bubbles: true, cancelable: true, composed: true };
  overlay.arm();
  el('div').dispatchEvent(new MouseEvent('click', opts));
  const input = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
  input.value = id;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ...opts }));
  overlay.acked(id, false, undefined, { relay: true });
}

describe('restore after a dismissal', () => {
  it('does not bring back a Fixed mark the person dismissed when the next inbox snapshot arrives', () => {
    const { root, overlay } = setup(true);
    const rows = [entry('a', 1)];
    overlay.restore(rows);
    expect(dots(root)).toHaveLength(1);
    dismiss(root);
    expect(dots(root)).toHaveLength(0);
    for (let i = 0; i < 3; i += 1) overlay.restore(rows);
    expect(dots(root)).toHaveLength(0);
    overlay.restore([{ ...rows[0]!, n: 4 }]);
    expect(dots(root)).toHaveLength(0);
  });

  it('does not bring back a Fixed mark that cleared on its timer', () => {
    const { root, overlay } = setup(false);
    const rows = [entry('a', 1)];
    overlay.restore(rows);
    vi.advanceTimersByTime(FIXED_CLEAR_MS);
    expect(dots(root)).toHaveLength(0);
    overlay.restore(rows);
    expect(dots(root)).toHaveLength(0);
  });

  it('brings a dismissed mark back when its row moves to another state', () => {
    const { root, overlay } = setup(true);
    const row = entry('a', 1);
    overlay.restore([row]);
    dismiss(root);
    overlay.restore([{ ...row, state: 'running' }]);
    expect(shown(root)).toEqual([['1', 'running']]);
    overlay.restore([row]);
    expect(shown(root)).toEqual([['1', 'done']]);
  });

  it('keeps the other restored marks and the marks of this session as they are', () => {
    const { root, overlay } = setup(true);
    const rows = [entry('a', 1), entry('b', 2)];
    overlay.restore(rows);
    sendHere(root, overlay, 's1');
    const before = shown(root);
    expect(before).toHaveLength(3);
    dismiss(root);
    overlay.restore(rows);
    overlay.restore(rows);
    expect(shown(root)).toEqual(before.slice(1));
  });

  it('records nothing and does not throw for a removed mark without an id', () => {
    const host = el('div');
    const root = host.attachShadow({ mode: 'open' });
    const mark = {
      dot: { remove: vi.fn() },
      bubble: { element: document.createElement('div'), destroy: vi.fn() },
      lastState: 'sent',
    } as unknown as TrackedMark;
    const state: Parameters<typeof dismissMarks>[0]['state'] = { marks: [mark] };
    dismissMarks({ root, host, launcher: { update: vi.fn() }, state });
    expect(() => vi.advanceTimersByTime(FIXED_CLEAR_MS)).not.toThrow();
    expect(state.marks).toEqual([]);
    expect(state.dismissed).toBeUndefined();
  });
});
