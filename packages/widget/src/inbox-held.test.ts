// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { renderHeldActions, renderWithdraw } from './inbox-held';
import type { InboxRowView } from './inbox-sections';
import { createVerdictPort, type VerdictPort } from './inbox-verdict';
import { mountInboxView } from './inbox-view';
import { inboxViewRules } from './inbox-view-styles';

const row = (extra: Partial<InboxRowView> = {}): InboxRowView => ({
  id: 'm1',
  status: 'new',
  iteration: 1,
  comment: 'The pricing button is cut off on small screens, please look',
  createdAt: 't',
  route: '/',
  iterations: [],
  ...extra,
});

function setup(opts: { throws?: boolean; caps?: string[] } = {}) {
  const send = vi.fn(() => {
    if (opts.throws) throw new Error('closed');
  });
  const hot = { send, on: vi.fn(), off: vi.fn() };
  const caps = opts.caps ?? ['reopen', 'list', 'verdict', 'clear'];
  const verdict: VerdictPort | undefined = createVerdictPort({ hot, caps });
  return { send, verdict, doc: document };
}
const held = (r: InboxRowView, o: { tracker?: boolean; verdict?: VerdictPort; busy?: boolean }) => {
  const { doc } = setup();
  return renderHeldActions({ doc, row: r, tracker: o.tracker ?? true, busy: false, ...o });
};
const inRow = (actions: HTMLElement) => {
  const node = document.createElement('div');
  node.className = 'pb-iv-row';
  const line = document.createElement('span');
  line.className = 'pb-iv-line';
  node.append(line, actions);
  return { node, line, btn: actions.querySelector('button') as HTMLButtonElement };
};

describe('held row actions', () => {
  it('offers Park only on a new unparked row, with the verdict capability and a Tracker tab', () => {
    const { verdict } = setup();
    const label = (r: InboxRowView, o: object) =>
      held(r, { verdict, ...o })?.actions.querySelector('button')?.textContent;
    expect(label(row(), {})).toBe('Park');
    expect(label(row({ status: 'ack' }), {})).toBeUndefined();
    expect(label(row({ status: 'proposed' }), {})).toBeUndefined();
    expect(label(row(), { tracker: false })).toBeUndefined();
    expect(label(row(), { verdict: undefined })).toBeUndefined();
    const name = held(row(), { verdict })
      ?.actions.querySelector('button')
      ?.getAttribute('aria-label');
    expect(name).toBe('Park: The pricing button is cut off on small s');
    expect(setup({ caps: ['list'] }).verdict).toBeUndefined();
  });

  it('offers Unpark on a parked row that is not accepted', () => {
    const { verdict } = setup();
    const label = (r: InboxRowView, o: object = {}) =>
      held(r, { verdict, ...o })?.actions.querySelector('button')?.textContent;
    expect(label(row({ parked: true }))).toBe('Unpark');
    expect(label(row({ parked: true, status: 'ack' }), { tracker: false })).toBe('Unpark');
    expect(label(row({ parked: true, status: 'accepted' }))).toBeUndefined();
    expect(label(row({ parked: true }), { verdict: undefined })).toBeUndefined();
  });

  it('sends park or unpark for the row and disables its button until the next snapshot', () => {
    const { verdict, send } = setup();
    for (const [r, word] of [
      [row(), 'park'],
      [row({ parked: true }), 'unpark'],
    ] as const) {
      const { btn } = inRow(held(r, { verdict })!.actions);
      expect(btn.disabled).toBe(false);
      btn.click();
      expect(send).toHaveBeenLastCalledWith('passback:verdict', {
        v: 1,
        markId: 'm1',
        verdict: word,
      });
      expect(btn.disabled).toBe(true);
      expect(btn.getAttribute('aria-busy')).toBe('true');
    }
    const busy = inRow(held(row(), { verdict, busy: true })!.actions).btn;
    expect(busy.disabled).toBe(true);
  });

  it('says it could not park or unpark when the send fails', () => {
    const { verdict } = setup({ throws: true });
    for (const [r, text] of [
      [row(), 'Could not park. Try again.'],
      [row({ parked: true }), 'Could not unpark. Try again.'],
    ] as const) {
      const { btn, line } = inRow(held(r, { verdict })!.actions);
      btn.click();
      expect(line.textContent).toBe(text);
      expect(btn.disabled).toBe(false);
    }
  });
});

function mount(site: boolean) {
  const doc = document.implementation.createHTMLDocument('');
  if (site) {
    const script = doc.createElement('script');
    script.setAttribute('data-passback-endpoint', 'https://x.test/ingest');
    doc.head.append(script);
  }
  const [host, content] = [doc.createElement('div'), doc.createElement('div')];
  host.append(content);
  doc.body.append(host);
  let push: (data: unknown) => void = () => {};
  const send = vi.fn();
  const on = (_event: string, cb: (data: unknown) => void) => void (push = cb);
  const caps = ['reopen', 'list', 'verdict', 'clear'];
  const win = { __passback: { hot: { send, on, off: vi.fn() }, caps }, navigator: {} };
  mountInboxView({ content, host, win: win as unknown as Window });
  const items = (rows: InboxRowView[]) => push({ v: 1, items: rows });
  const act = (label: string) =>
    [...content.querySelectorAll<HTMLButtonElement>('.pb-iv-act')].find(
      (b) => b.textContent === label,
    );
  return { host, content, send, items, act };
}

describe('held rows in the view', () => {
  it('lists a parked row in All with Unpark on a page without a Tracker tab', () => {
    const v = mount(false);
    v.items([row({ parked: true }), row({ id: 'm2' })]);
    expect(v.content.textContent).toContain('Parked for the tracker');
    expect(v.act('Unpark')).toBeDefined();
    expect(v.act('Park')).toBeUndefined();
  });

  it('keeps a sent button busy across renders until the next snapshot', () => {
    const v = mount(true);
    v.items([row()]);
    v.act('Park')!.click();
    v.host.dispatchEvent(new Event('passback:sync'));
    expect(v.act('Park')?.disabled).toBe(true);
    v.items([row()]);
    expect(v.act('Park')?.disabled).toBe(false);
    v.content.querySelector<HTMLElement>('.pb-iv-row')!.click();
    v.content.querySelector<HTMLButtonElement>('.pb-it-withdraw-btn')!.click();
    v.host.dispatchEvent(new Event('passback:sync'));
    expect(v.content.querySelector<HTMLButtonElement>('.pb-it-withdraw-btn')?.disabled).toBe(true);
    expect(v.content.textContent).toContain('Withdrawn. The agent is told on its next wait.');
  });
});

describe('withdraw in the open task', () => {
  it('offers Withdraw only on a new or acknowledged row with the verdict capability', () => {
    const { verdict, doc } = setup();
    const has = (r: InboxRowView, v: VerdictPort | null = verdict ?? null) =>
      renderWithdraw({ doc, row: r, verdict: v ?? undefined }) !== undefined;
    expect(has(row())).toBe(true);
    expect(has(row({ status: 'ack' }))).toBe(true);
    expect(has(row({ parked: true }))).toBe(true);
    for (const status of ['proposed', 'verified', 'accepted', 'declined', 'withdrawn'])
      expect(has(row({ status }))).toBe(false);
    expect(has(row(), null)).toBe(false);
  });

  it('sends withdraw for the open row and says it could not withdraw when the send fails', () => {
    const ok = setup();
    const node = renderWithdraw({ doc: ok.doc, row: row(), verdict: ok.verdict })!;
    const btn = node.querySelector('button') as HTMLButtonElement;
    btn.click();
    expect(ok.send).toHaveBeenCalledWith('passback:verdict', {
      v: 1,
      markId: 'm1',
      verdict: 'withdraw',
    });
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(node.textContent).toContain('Withdrawn. The agent is told on its next wait.');

    const bad = setup({ throws: true });
    const failed = renderWithdraw({ doc: bad.doc, row: row(), verdict: bad.verdict })!;
    const again = failed.querySelector('button') as HTMLButtonElement;
    again.click();
    expect(failed.textContent).toContain('Could not withdraw. Try again.');
    expect(again.disabled).toBe(false);
  });

  it('writes no hex or rgb literal in the held-row styles', () => {
    const text = inboxViewRules();
    expect(text).toContain('.pb-it-withdraw-btn');
    expect(text).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(text).not.toMatch(/rgba?\(/i);
  });
});
