// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Overlay, SubmitDetail } from './overlay';
import type { BatchOutcome, SubmitAllDetail } from './send-batch';
import { createOverlay } from './overlay';
import { sendAll, type SendAllCtx } from './send-all';
import { CLASS } from './styles';
import { TRAY_CLASS } from './tray-view';
import { keptReducer } from './kept';

const scope = globalThis as { __passback?: unknown };
let overlays: Overlay[] = [];
let captured: SendAllCtx;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  overlays.forEach((overlay) => overlay.destroy());
  overlays = [];
  delete scope.__passback;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

function setup() {
  scope.__passback = {
    fx: { addons: [sendAll, (ctx: unknown): void => void (captured = ctx as SendAllCtx)] },
  };
  const host = document.body.appendChild(document.createElement('div'));
  const root = host.attachShadow({ mode: 'open' });
  const batches: SubmitAllDetail[] = [];
  host.addEventListener('passback:submit-all', (event) =>
    batches.push((event as CustomEvent<SubmitAllDetail>).detail),
  );
  const overlay = createOverlay({
    doc: document,
    root,
    host,
    selectorOf: (el) => el.tagName.toLowerCase(),
    onSubmit: vi.fn<(detail: SubmitDetail) => void>(),
    drawing: { toggle: vi.fn(), cancel: vi.fn() },
  });
  overlays.push(overlay);
  return { host, root, overlay, batches };
}
type R = ReturnType<typeof setup>;

function keep(r: R, text: string): void {
  const target = document.body.appendChild(document.createElement('div'));
  target.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }),
  );
  const input = r.root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
  input.value = text;
  input.dispatchEvent(new Event('input'));
  r.root.querySelector<HTMLElement>('[data-role="add-more"]')!.click();
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const armedHint = (r: R) =>
  r.root.querySelector<HTMLElement>(`.${CLASS.hint}:not([data-pb-drawing])`);
const pill = (r: R) =>
  r.root.querySelector<HTMLButtonElement>(`.${CLASS.hint} button[data-act='send']`);
const count = (r: R) => pill(r)?.querySelector('[data-count]')?.textContent;
const listButton = (r: R) =>
  r.root.querySelector<HTMLElement>(`.${TRAY_CLASS.tray} .${CLASS.send}`);
const ok = (n: number): BatchOutcome => ({
  ok: true,
  ids: Array<string>(n).fill('t1'),
  trimmed: Array<boolean>(n).fill(false),
  notes: Array<string | undefined>(n).fill(undefined),
  relay: true,
});

describe('notch kept comments', () => {
  it('the notch shows Send all with the number of kept comments', async () => {
    const r = setup();
    r.overlay.arm();
    keep(r, 'one');
    await flush();
    expect(pill(r)!.textContent).toContain('Send all');
    expect(count(r)).toBe('1');
    expect(armedHint(r)!.textContent).toContain('Click anything to comment');
    keep(r, 'two');
    await flush();
    expect(count(r)).toBe('2');
    expect(r.root.querySelectorAll(`.${CLASS.hint} button[data-act='send']`)).toHaveLength(1);
  });

  it('the notch Send all sends kept comments as the list does', async () => {
    const r = setup();
    r.overlay.arm();
    keep(r, 'one');
    keep(r, 'two');
    await flush();
    expect(listButton(r)).not.toBeNull();
    pill(r)!.click();
    expect(r.batches).toHaveLength(1);
    expect(r.batches[0]!.dest).toBe('agent');
    expect(r.batches[0]!.details.map((d) => d.comment)).toEqual(['one', 'two']);
    expect(r.overlay.phase()).toBe('sending');
    expect(pill(r)).toBeNull();
    r.batches[0]!.settle(ok(2));
    await flush();
    expect(pill(r)).toBeNull();

    overlays.forEach((overlay) => overlay.destroy());
    overlays = [];
    document.body.innerHTML = '';
    const list = setup();
    list.overlay.arm();
    keep(list, 'one');
    keep(list, 'two');
    await flush();
    const button = listButton(list);
    expect(button).not.toBeNull();
    button!.click();
    expect(list.batches).toHaveLength(1);
    expect(list.batches[0]!.dest).toBe(r.batches[0]!.dest);
    expect(list.batches[0]!.details.map((d) => d.comment)).toEqual(['one', 'two']);
    expect(list.overlay.phase()).toBe('sending');
  });

  it('the notch shows no kept-comments pill when nothing is kept', async () => {
    const r = setup();
    r.overlay.arm();
    await flush();
    expect(pill(r)).toBeNull();
    expect(armedHint(r)!.hasAttribute('data-draw')).toBe(false);
    keep(r, 'one');
    await flush();
    expect(pill(r)).not.toBeNull();
  });

  it('the pill number equals the number of comments one click sends', async () => {
    const r = setup();
    r.overlay.arm();
    keep(r, 'one');
    keep(r, 'two');
    keep(r, 'three');
    captured.state.kept = keptReducer(captured.state.kept, { type: 'dest', n: 2, dest: 'tracker' });
    r.host.dispatchEvent(new Event('passback:sync'));
    await flush();
    const shown = Number(count(r));
    pill(r)!.click();
    expect(r.batches).toHaveLength(1);
    expect(r.batches[0]!.details).toHaveLength(shown);
    expect(shown).toBe(2);
    expect(r.batches[0]!.details.map((d) => d.comment)).toEqual(['one', 'three']);
  });

  it('the kept-comments pill is removed when drawing starts', async () => {
    const r = setup();
    r.overlay.arm();
    keep(r, 'one');
    await flush();
    expect(pill(r)).not.toBeNull();
    const draw = document.createElement('div');
    draw.className = CLASS.hint;
    draw.setAttribute('data-draw', '');
    r.root.append(draw);
    await flush();
    expect(pill(r)).toBeNull();
    draw.remove();
    await flush();
    expect(count(r)).toBe('1');
    expect(armedHint(r)!.hidden).toBe(false);
  });
});
