import { describe, expect, it, vi } from 'vitest';
import type { Collector } from './collect';
import { restorableOf, watchInbox } from './inbox-restore';
import type { InboxRowView } from './inbox-sections';

type Cb = (data: unknown) => void;
const row = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  status,
  comment: 'c',
  iterations: [],
  selector: `[data-testid="${id}"]`,
  target: { tag: 'button', text: id },
  ...extra,
});
const rowsOf = (...r: ReturnType<typeof row>[]) => r as unknown as InboxRowView[];
function storeOf(rows: InboxRowView[]) {
  const seq = rows.map((r, i) => [r.id, i + 1] as const);
  return { rows: () => rows, numberOf: (id: string) => seq.find(([k]) => k === id)?.[1] };
}

describe('restorableOf', () => {
  it('maps new, ack, proposed, verified and declined rows to queued, running, done and failed', () => {
    const rows = rowsOf(
      row('a', 'new'),
      row('b', 'ack'),
      row('c', 'proposed'),
      row('d', 'verified'),
      row('e', 'declined'),
      row('f', 'ack', { iterations: [{ n: 1, statuses: [{ state: 'failed', at: 'x' }] }] }),
    );
    expect(restorableOf(storeOf(rows)).map((e) => [e.id, e.n, e.state])).toEqual([
      ['a', 1, 'queued'],
      ['b', 2, 'running'],
      ['c', 3, 'done'],
      ['d', 4, 'done'],
      ['e', 5, 'failed'],
      ['f', 6, 'failed'],
    ]);
  });

  it('leaves out accepted, withdrawn and parked rows and rows without a target', () => {
    const rows = rowsOf(
      row('a', 'accepted'),
      row('b', 'withdrawn'),
      row('c', 'new', { parked: true }),
      row('d', 'new', { target: undefined }),
      row('e', 'new', { selector: undefined }),
      row('ok', 'new'),
    );
    expect(restorableOf(storeOf(rows)).map((e) => e.id)).toEqual(['ok']);
  });

  it('builds the resolve target from the stored selector and the row target', () => {
    const selectors = ['[data-testid="x"]', '#x', '[id="x"]', 'role=button[name="x"]', 'main > p'];
    const rows = rowsOf(...selectors.map((s, i) => row(`r${i}`, 'new', { selector: s })));
    const entries = restorableOf(storeOf(rows));
    expect(entries.map((e) => e.target.selectors)).toEqual([
      [{ kind: 'testid', value: selectors[0] }],
      [{ kind: 'id', value: '#x' }],
      [{ kind: 'id', value: '[id="x"]' }],
      [{ kind: 'role', value: selectors[3] }],
      [{ kind: 'css', value: 'main > p' }],
    ]);
    expect(entries[0]?.target).toMatchObject({ tag: 'button', text: 'r0' });
  });

  it('gives the mark the last status message, else the agent text', () => {
    const st = (message?: string) => ({
      state: 'running',
      at: 'x',
      ...(message ? { message } : {}),
    });
    const rows = rowsOf(
      row('a', 'ack', { iterations: [{ n: 1, statuses: [st('old'), st('latest')] }] }),
      row('b', 'proposed', { iterations: [{ n: 1, statuses: [st()], agent: { text: 'did it' } }] }),
      row('c', 'new', { iterations: [{ n: 1 }] }),
    );
    expect(restorableOf(storeOf(rows)).map((e) => e.message)).toEqual([
      'latest',
      'did it',
      undefined,
    ]);
  });
});

function harness(caps: unknown = ['list']) {
  const handlers = new Map<string, Cb>();
  const hot = {
    send: vi.fn(),
    on: vi.fn((event: string, cb: Cb) => void handlers.set(event, cb)),
    off: vi.fn((event: string) => void handlers.delete(event)),
  };
  const win = { __passback: { hot, caps }, document: {} } as unknown as Window;
  const push = (...items: unknown[]) => handlers.get('passback:items')?.({ v: 1, items });
  const found = new Map<string, Element>();
  const collector = {
    reresolve: vi.fn((_doc: unknown, target: { selectors: { value: string }[] }) => {
      const element = found.get(target.selectors[0]!.value);
      return element ? { element, via: 'testid' } : null;
    }),
  } as unknown as Collector;
  const ensureCollector = vi.fn(() => Promise.resolve(collector));
  const restore = vi.fn();
  const stop = watchInbox({ win, ensureCollector, restore });
  return { push, found, ensureCollector, restore, stop, collector };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('watchInbox', () => {
  it('does not load the collector while no row can be restored', async () => {
    const h = harness();
    h.push();
    h.push(row('a', 'accepted'));
    await tick();
    expect(h.ensureCollector).not.toHaveBeenCalled();
    expect(h.restore).not.toHaveBeenCalled();
  });

  it('restores the rows that resolve on this page with their list numbers and skips the rest', async () => {
    const h = harness();
    const el = {} as Element;
    h.found.set('[data-testid="b"]', el);
    h.push(row('a', 'proposed'), row('b', 'new'), row('c', 'ack'));
    await tick();
    expect(h.restore).toHaveBeenCalledTimes(1);
    const entries = h.restore.mock.calls[0]![0] as { id: string; n: number; element: Element }[];
    // Needs you, then Working (snapshot order), then Fixed
    expect(entries.map((e) => [e.id, e.n, e.element])).toEqual([['b', 1, el]]);
    h.push(row('a', 'proposed'));
    await tick();
    expect(h.restore).toHaveBeenLastCalledWith([]);
    h.stop();
  });

  it('drops a resolution that a newer snapshot overtook', async () => {
    const h = harness();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    h.ensureCollector.mockImplementationOnce(() => gate.then(() => h.collector));
    h.found.set('[data-testid="a"]', {} as Element);
    h.found.set('[data-testid="b"]', {} as Element);
    h.push(row('a', 'new'));
    h.push(row('b', 'new'));
    release();
    await tick();
    expect(h.restore).toHaveBeenCalledTimes(1);
    expect((h.restore.mock.calls[0]![0] as { id: string }[]).map((e) => e.id)).toEqual(['b']);
  });

  it('swallows a failed collector load', async () => {
    const h = harness();
    h.ensureCollector.mockRejectedValueOnce(new Error('chunk'));
    h.push(row('a', 'new'));
    await tick();
    expect(h.restore).not.toHaveBeenCalled();
    h.stop();
  });
});
