// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { inboxViewRules } from './inbox-view-styles';
import { mountInboxView } from './inbox-view';

type Cb = (data: unknown) => void;
const row = (id: string, status: string, comment = `Comment ${id}`) => ({
  id,
  status,
  comment,
  iterations: [],
  createdAt: 't',
  route: '/',
  iteration: 1,
});
const ROWS = [
  row('p1', 'proposed'),
  row('v1', 'verified'),
  row('a1', 'accepted'),
  row('w1', 'ack'),
];

function setup(caps: string[], opts: { sendThrows?: boolean; queued?: boolean } = {}) {
  const doc = document.implementation.createHTMLDocument('');
  const host = doc.createElement('div');
  const panel = doc.createElement('section');
  const content = doc.createElement('div');
  panel.append(content);
  host.append(panel);
  doc.body.append(host);
  const handlers = new Map<string, Cb>();
  const send = vi.fn((event: string) => {
    if (opts.sendThrows && event === 'passback:verdict') throw new Error('closed');
    if (event === 'passback:reopen' && opts.queued !== false)
      queueMicrotask(() =>
        handlers.get('passback:status')?.({ markId: reopened, state: 'queued' }),
      );
  });
  let reopened = '';
  const hot = {
    send: (event: string, data: unknown) => {
      reopened = (data as { markId?: string }).markId ?? '';
      send(event);
      sentLog.push([event, data]);
    },
    on: (event: string, cb: Cb) => void handlers.set(event, cb),
    off: vi.fn(),
  };
  const sentLog: [string, unknown][] = [];
  const win = { __passback: { hot, caps }, navigator: { platform: 'Linux' } } as unknown as Window;
  mountInboxView({ content, host, win });
  const push = (items: unknown[]) => handlers.get('passback:items')?.({ v: 1, items });
  const rows = () => [...content.querySelectorAll<HTMLElement>('.pb-iv-row')];
  const names = (r: HTMLElement) => [...r.querySelectorAll('.pb-iv-act')].map((b) => b.textContent);
  const tab = (key: string) => content.querySelector<HTMLElement>(`[data-key="${key}"]`)?.click();
  const sent = (event: string) => sentLog.filter(([e]) => e === event).map(([, d]) => d);
  return { doc, content, push, rows, names, tab, sent };
}
const BOTH = ['list', 'verdict', 'reopen'];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('fixed row actions', () => {
  it('offers Accept and Still wrong only on proposed or verified rows and only with the matching capability', () => {
    const both = setup(BOTH);
    both.push(ROWS);
    expect(both.rows().map(both.names)).toEqual([
      ['Open'],
      ['Accept', 'Still wrong'],
      ['Accept', 'Still wrong'],
      ['Open'],
    ]);
    const verdictOnly = setup(['list', 'verdict']);
    verdictOnly.push(ROWS);
    expect(verdictOnly.rows().map(verdictOnly.names)).toEqual([
      ['Open'],
      ['Accept'],
      ['Accept'],
      ['Open'],
    ]);
    const reopenOnly = setup(['list', 'reopen']);
    reopenOnly.push(ROWS);
    expect(reopenOnly.rows().map(reopenOnly.names)[1]).toEqual(['Still wrong']);
    const none = setup(['list']);
    none.push(ROWS);
    expect(none.rows().map(none.names)).toEqual([['Open'], ['Open'], ['Open'], ['Open']]);
    expect(none.sent('passback:verdict')).toEqual([]);
    const label = both.rows()[1]?.querySelector('.pb-iv-act')?.getAttribute('aria-label');
    expect(label).toBe('Accept: Comment p1');
  });

  it('sends an accept verdict for the row and disables its buttons until the next snapshot', () => {
    const t = setup(BOTH);
    t.push(ROWS);
    t.rows()[1]?.querySelector<HTMLButtonElement>('.pb-iv-act')?.click();
    expect(t.sent('passback:verdict')).toEqual([{ v: 1, markId: 'p1', verdict: 'accept' }]);
    const buttons = [...(t.rows()[1]?.querySelectorAll<HTMLButtonElement>('.pb-iv-act') ?? [])];
    expect(buttons.map((b) => [b.disabled, b.getAttribute('aria-busy')])).toEqual([
      [true, 'true'],
      [true, 'true'],
    ]);
    t.push(ROWS.map((r) => (r.id === 'p1' ? { ...r, status: 'accepted' } : r)));
    expect(t.rows().map(t.names)[1]).toEqual(['Open']);
    expect(t.rows()[1]?.textContent).toContain('Accepted');
  });

  it('says it could not accept when the verdict send fails', () => {
    const t = setup(BOTH, { sendThrows: true });
    t.push(ROWS);
    t.rows()[1]?.querySelector<HTMLButtonElement>('.pb-iv-act')?.click();
    expect(t.rows()[1]?.querySelector('.pb-iv-line')?.textContent).toBe(
      'Could not accept. Try again.',
    );
    const buttons = [...(t.rows()[1]?.querySelectorAll<HTMLButtonElement>('.pb-iv-act') ?? [])];
    expect(buttons.map((b) => b.disabled)).toEqual([false, false]);
  });

  it('opens the reopen box under the row and sends the trimmed text through the reopen port', async () => {
    const t = setup(BOTH);
    t.push(ROWS);
    t.rows()[1]?.querySelectorAll<HTMLButtonElement>('.pb-iv-act')[1]?.click();
    const box = t.content.querySelector('.pb-fx-box');
    expect(box?.closest('.pb-iv-row')?.getAttribute('data-key')).toBe('p1');
    expect(box?.textContent).toContain('What is still wrong?');
    const area = box?.querySelector('textarea') as HTMLTextAreaElement;
    area.value = '  still too small  ';
    area.dispatchEvent(new Event('input', { bubbles: true }));
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(t.sent('passback:reopen')).toEqual([{ v: 1, markId: 'p1', comment: 'still too small' }]);
    expect(t.content.querySelector('.pb-fx-box')).toBeNull();
  });

  it('keeps the text and says it could not send when the reopen port answers false', async () => {
    vi.useFakeTimers();
    try {
      const t = setup(BOTH, { queued: false });
      t.push(ROWS);
      t.rows()[1]?.querySelectorAll<HTMLButtonElement>('.pb-iv-act')[1]?.click();
      const area = t.content.querySelector('.pb-fx-box textarea') as HTMLTextAreaElement;
      area.value = 'still too small';
      area.dispatchEvent(new Event('input', { bubbles: true }));
      area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await vi.advanceTimersByTimeAsync(5001);
      const again = t.content.querySelector('.pb-fx-box textarea') as HTMLTextAreaElement;
      expect(again.value).toBe('still too small');
      expect(t.content.querySelector('.pb-fx-box')?.textContent).toContain(
        'Could not send. Try again.',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps one reopen box open at a time', () => {
    const t = setup(BOTH);
    t.push(ROWS);
    t.rows()[1]?.querySelectorAll<HTMLButtonElement>('.pb-iv-act')[1]?.click();
    t.rows()[2]?.querySelectorAll<HTMLButtonElement>('.pb-iv-act')[1]?.click();
    const boxes = t.content.querySelectorAll('.pb-fx-box');
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.closest('.pb-iv-row')?.getAttribute('data-key')).toBe('v1');
    boxes[0]
      ?.querySelector('textarea')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(t.content.querySelector('.pb-fx-box')).toBeNull();
  });

  it('accepts every proposed or verified row from Accept all in the Fixed tab only', () => {
    const t = setup(BOTH);
    t.push(ROWS);
    expect(t.content.querySelector('.pb-iv-all')).toBeNull();
    t.tab('fixed');
    const all = t.content.querySelector<HTMLButtonElement>('.pb-iv-all');
    expect(all?.textContent).toBe('Accept all 2');
    all?.click();
    expect(t.sent('passback:verdict')).toEqual([
      { v: 1, markId: 'p1', verdict: 'accept' },
      { v: 1, markId: 'v1', verdict: 'accept' },
    ]);
    expect(t.content.querySelector<HTMLButtonElement>('.pb-iv-all')?.disabled).toBe(true);
    t.push(ROWS.map((r) => ({ ...r, status: 'accepted' })));
    expect(t.content.querySelector<HTMLButtonElement>('.pb-iv-all')?.textContent).toBe(
      'Accept all 0',
    );
    expect(t.content.querySelector<HTMLButtonElement>('.pb-iv-all')?.disabled).toBe(true);
    const noVerdict = setup(['list', 'reopen']);
    noVerdict.push(ROWS);
    noVerdict.tab('fixed');
    expect(noVerdict.content.querySelector('.pb-iv-all')).toBeNull();
  });

  it('writes no hex or rgb literal in the fixed-row styles', () => {
    const css = inboxViewRules();
    const block = css.slice(css.indexOf('.pb-iv-acts'));
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    expect(css).toContain('.pb-fx-box');
  });
});
