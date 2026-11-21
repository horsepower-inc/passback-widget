// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { InboxRowView } from './inbox-sections';
import { taskNode, taskOf } from './inbox-task';
import { mountInboxView } from './inbox-view';

const row = (extra: Partial<InboxRowView> = {}): InboxRowView => ({
  id: 'm1',
  status: 'proposed',
  iteration: 2,
  comment: 'Button is cut off\nsecond line',
  createdAt: '2026-10-24T14:00:00Z',
  route: '/pricing',
  file: 'src/App.tsx:42:7',
  iterations: [],
  ...extra,
});

describe('inbox task', () => {
  it('takes the title, file and line, page and round from the row', () => {
    const t = taskOf(row(), 3);
    expect(t).toMatchObject({
      number: 3,
      title: 'Button is cut off',
      fileLine: 'src/App.tsx:42',
      page: '/pricing',
      round: 'Round 2',
    });
    expect(taskOf(row({ comment: 'x'.repeat(100), file: 'a.ts' })).title).toHaveLength(80);
    expect(taskOf(row({ file: 'a.ts' })).fileLine).toBe('a.ts');
    expect(taskOf(row({ file: 'a.ts:5' })).fileLine).toBe('a.ts:5');
    expect('fileLine' in taskOf(row({ file: undefined }))).toBe(false);
    expect('number' in taskOf(row())).toBe(false);
  });

  it('orders the conversation from the comment through each iteration, status, reply and verdict', () => {
    const t = taskOf(
      row({
        iterations: [
          {
            n: 1,
            statuses: [
              { state: 'queued', at: '2026-10-24T14:01:00Z' },
              { state: 'ack', message: 'Looking', at: '2026-10-24T14:02:00Z' },
            ],
            agent: { at: '2026-10-24T14:03:00Z', text: 'Fixed it' },
            human: { at: '2026-10-24T14:04:00Z', verdict: { kind: 'decline', reason: 'No' } },
          },
        ],
      }),
    );
    expect(t.lines.map((l) => [l.who, l.text])).toEqual([
      ['You', 'Button is cut off\nsecond line'],
      ['Agent', 'queued'],
      ['Agent', 'Looking'],
      ['Agent', 'Fixed it'],
      ['You: still wrong', 'No'],
    ]);
  });

  it('shows an accepted verdict, a still-wrong verdict with its reason and a comment verdict', () => {
    const at = '2026-10-24T15:00:00Z';
    const verdicts = [
      { kind: 'accept' },
      { kind: 'decline', reason: 'Still off' },
      { kind: 'comment', text: 'Also the icon' },
    ];
    const t = taskOf(
      row({ iterations: verdicts.map((verdict, i) => ({ n: i, human: { at, verdict } })) }),
    );
    expect(t.lines.slice(1).map((l) => [l.who, l.text, l.kind])).toEqual([
      ['You accepted', '', 'verdict'],
      ['You: still wrong', 'Still off', 'verdict'],
      ['You', 'Also the icon', 'verdict'],
    ]);
  });

  it('renders comment text as text and not as markup', () => {
    const doc = document.implementation.createHTMLDocument('');
    const node = taskNode(
      doc,
      row({ comment: '<img src=x onerror=alert(1)><b>hi</b>' }),
      undefined,
      {
        port: undefined,
        mac: false,
        state: { draft: '', failed: false },
        close: () => {},
      },
    );
    expect(node.querySelector('img, b')).toBeNull();
    expect(node.querySelector('.pb-it-text')?.textContent).toContain('<b>hi</b>');
  });
});

function setup(rowExtra: Partial<InboxRowView> = {}, port?: { ok: boolean }, verdict = false) {
  const doc = document.implementation.createHTMLDocument('');
  const host = doc.createElement('div');
  const panel = doc.createElement('section');
  const content = doc.createElement('div');
  panel.append(content);
  host.append(panel);
  doc.body.append(host);
  const handlers = new Map<string, (d: unknown) => void>();
  const send = vi.fn();
  const hot = {
    send,
    on: (e: string, cb: (d: unknown) => void) => void handlers.set(e, cb),
    off: vi.fn(),
  };
  const caps = [...(port ? ['list', 'reopen'] : ['list']), ...(verdict ? ['verdict'] : [])];
  // The reopen port answers when the host reports the mark queued.
  send.mockImplementation((event: string) => {
    if (event === 'passback:reopen' && port?.ok)
      queueMicrotask(() => handlers.get('passback:status')?.({ markId: 'm1', state: 'queued' }));
  });
  const win = { __passback: { hot, caps }, navigator: { platform: 'Linux' } } as unknown as Window;
  const dispose = mountInboxView({ content, host, win, onOpen: undefined });
  const push = (items: unknown[]) => handlers.get('passback:items')?.({ v: 1, items });
  push([row(rowExtra), row({ id: 'm2', status: 'ack', comment: 'Other' })]);
  const open = () => content.querySelector<HTMLElement>('.pb-iv-row[data-key="m1"]')?.click();
  const esc = () => {
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    content.dispatchEvent(e);
    return e;
  };
  const box = () => content.querySelector<HTMLTextAreaElement>('.pb-it-box');
  const sendBtn = () => content.querySelector<HTMLButtonElement>('.pb-it-send');
  return { content, panel, push, open, esc, box, sendBtn, send, dispose };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('inbox task in the view', () => {
  it('enables the answer box only for a fixed row with a reopen port and sends the trimmed text', async () => {
    const a = setup({}, { ok: true });
    a.open();
    expect(a.box()?.disabled).toBe(false);
    a.box()!.value = '  more please  ';
    a.box()!.dispatchEvent(new Event('input'));
    a.sendBtn()!.click();
    await flush();
    expect(a.send).toHaveBeenCalledWith(
      'passback:reopen',
      expect.objectContaining({ comment: 'more please' }),
    );
    expect(a.box()?.value).toBe('');

    // A snapshot that lands while Send waits redraws the box; the answer still clears it.
    const d = setup({}, { ok: true });
    d.open();
    d.box()!.value = 'late';
    d.box()!.dispatchEvent(new Event('input'));
    d.sendBtn()!.click();
    d.push([row({ comment: 'Changed text' })]);
    expect(d.sendBtn()?.disabled).toBe(true);
    await flush();
    expect(d.box()?.value).toBe('');
    expect(d.sendBtn()?.disabled).toBe(false);

    const b = setup({ status: 'ack' }, { ok: true });
    b.open();
    expect(b.box()?.disabled).toBe(true);
    expect(b.content.querySelector('.pb-it-note')?.textContent).toBe(
      'You can answer once the agent has proposed a fix.',
    );

    const c = setup({});
    c.open();
    expect(c.box()?.disabled).toBe(true);
    expect(c.content.querySelector('.pb-it-note')?.textContent).toBe(
      'Answering is not available in this setup.',
    );
  });

  it('keeps the text and says it could not send when the reopen port answers false', async () => {
    vi.useFakeTimers();
    const a = setup({}, { ok: false });
    a.open();
    a.box()!.value = 'again';
    a.box()!.dispatchEvent(new Event('input'));
    a.sendBtn()!.click();
    // A snapshot that lands while Send waits redraws the task; the failure shows on the new nodes.
    a.push([row({ comment: 'Changed text' })]);
    await vi.advanceTimersByTimeAsync(6000);
    vi.useRealTimers();
    expect(a.box()?.value).toBe('again');
    expect(a.content.querySelector('.pb-it-note')?.textContent).toBe('Could not send. Try again.');
    expect(a.sendBtn()?.disabled).toBe(false);
  });

  it('closes the task with Esc or the List button and consumes Esc only while it is open', () => {
    const a = setup();
    const before = a.esc();
    expect(before.defaultPrevented).toBe(false);
    a.open();
    expect(a.content.querySelector('.pb-it')).not.toBeNull();
    expect(a.content.querySelector('.pb-iv-menu')).toBeNull();
    const during = a.esc();
    expect(during.defaultPrevented).toBe(true);
    expect(a.content.querySelector('.pb-it')).toBeNull();
    expect(a.content.querySelector('.pb-iv-list')).not.toBeNull();
    a.open();
    a.content.querySelector<HTMLElement>('.pb-it-back')!.click();
    expect(a.content.querySelector('.pb-it')).toBeNull();
  });

  it('renders again from a new snapshot and returns to the list when the row is gone', () => {
    const a = setup();
    a.open();
    a.box()!.value = 'draft';
    a.box()!.dispatchEvent(new Event('input'));
    a.push([row({ comment: 'Changed text' })]);
    expect(a.content.querySelector('.pb-it-name')?.textContent).toBe('Changed text');
    expect(a.box()?.value).toBe('draft');
    a.push([row({ id: 'other', comment: 'Other' })]);
    expect(a.content.querySelector('.pb-it')).toBeNull();
    expect(a.content.querySelector('.pb-iv-list')).not.toBeNull();
    // A withdrawn row stays in the snapshot but has left the inbox, so the task closes too.
    a.push([row()]);
    a.open();
    expect(a.content.querySelector('.pb-it')).not.toBeNull();
    a.push([row({ status: 'withdrawn' })]);
    expect(a.content.querySelector('.pb-it')).toBeNull();
    expect(a.content.querySelector('.pb-iv-list')).not.toBeNull();
    a.dispose();
    expect(a.content.querySelector('.pb-iv')).toBeNull();
  });

  it('shows Withdraw on an underway task and returns to the list when the next snapshot drops the row', () => {
    const a = setup({ status: 'ack' }, undefined, true);
    a.open();
    const withdraw = a.content.querySelector<HTMLButtonElement>('.pb-it-withdraw-btn');
    expect(withdraw?.textContent).toBe('Withdraw');
    withdraw!.click();
    expect(a.send).toHaveBeenCalledWith('passback:verdict', {
      v: 1,
      markId: 'm1',
      verdict: 'withdraw',
    });
    expect(withdraw?.disabled).toBe(true);
    expect(a.content.querySelector('.pb-it-withdraw')?.textContent).toContain(
      'Withdrawn. The agent is told on its next wait.',
    );
    a.push([row({ status: 'withdrawn' })]);
    expect(a.content.querySelector('.pb-it')).toBeNull();
    expect(a.content.querySelector('.pb-iv-list')).not.toBeNull();

    const fixed = setup({ status: 'proposed' }, undefined, true);
    fixed.open();
    expect(fixed.content.querySelector('.pb-it-withdraw-btn')).toBeNull();
    const plain = setup({ status: 'ack' });
    plain.open();
    expect(plain.content.querySelector('.pb-it-withdraw-btn')).toBeNull();
  });

  describe('a question from the agent', () => {
    const asking = row({
      status: 'ack',
      iterations: [
        {
          n: 1,
          statuses: [{ state: 'question', message: 'Which color?', at: '2026-10-24T14:01:00Z' }],
        },
      ],
    });
    const draw = (answer?: { send(id: string, text: string): Promise<boolean> }) => {
      const state = { draft: '', failed: false };
      const node = taskNode(document, asking, undefined, {
        port: undefined,
        answer,
        mac: false,
        state,
        close: () => undefined,
      });
      document.body.append(node);
      return node;
    };

    it('tints the question line and names who asks', () => {
      const t = taskOf(asking);
      expect(t.lines.at(-1)).toMatchObject({
        who: 'Agent asks',
        text: 'Which color?',
        kind: 'question',
      });
      const node = draw();
      const line = node.querySelector('.pb-it-line[data-kind="question"]');
      expect(line?.querySelector('.pb-it-who')?.textContent).toBe('Agent asks');
      expect(line?.querySelector('.pb-it-text')?.textContent).toBe('Which color?');
    });

    it('sends the typed text through the answer port for a row awaiting an answer', async () => {
      const send = vi.fn().mockResolvedValue(true);
      const node = draw({ send });
      const area = node.querySelector<HTMLTextAreaElement>('.pb-it-box')!;
      const btn = node.querySelector<HTMLButtonElement>('.pb-it-send')!;
      expect(area.disabled).toBe(false);
      expect(btn.textContent).toBe('Answer Ctrl+Enter');
      area.value = '  Blue  ';
      btn.click();
      await new Promise((r) => setTimeout(r, 0));
      expect(send).toHaveBeenCalledWith('m1', 'Blue');
    });

    it('keeps the draft and says it could not send when the answer port answers false', async () => {
      const send = vi.fn().mockResolvedValue(false);
      const node = draw({ send });
      const area = node.querySelector<HTMLTextAreaElement>('.pb-it-box')!;
      area.value = 'Blue';
      area.dispatchEvent(new Event('input'));
      node.querySelector<HTMLButtonElement>('.pb-it-send')!.click();
      await new Promise((r) => setTimeout(r, 0));
      expect(area.value).toBe('Blue');
      expect(node.querySelector('.pb-it-note')?.textContent).toBe('Could not send. Try again.');
    });

    it('says answering is not available without an answer port', () => {
      const node = draw();
      expect(node.querySelector('.pb-it-note')?.textContent).toBe(
        'Answering is not available in this setup.',
      );
      expect(node.querySelector<HTMLTextAreaElement>('.pb-it-box')?.disabled).toBe(true);
    });
  });
});
