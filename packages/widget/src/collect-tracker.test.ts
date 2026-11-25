// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelMark } from '@passback/schema';
import type { Hot } from './channel';
import { collect } from './collect';
import type { Collector } from './collect';
import * as transportModule from './transport';

vi.mock('./transport', async (importOriginal) => {
  const original = await importOriginal<typeof import('./transport')>();
  return { ...original, createTransport: vi.fn(original.createTransport) };
});

function fakeHot() {
  const sent: ChannelMark[] = [];
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  const hot: Hot = {
    send(_event, data) {
      const mark = data as ChannelMark;
      sent.push(mark);
      for (const cb of handlers.get('passback:ack') ?? []) {
        cb({
          v: 1,
          batchId: mark.batch.id,
          accepted: mark.batch.marks.map(() => 'a1'),
          trimmed: [],
        });
      }
    },
    on(event, cb) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)?.add(cb);
    },
    off(event, cb) {
      handlers.get(event)?.delete(cb);
    },
  };
  return { hot, sent };
}

function stubRelay() {
  const fetchMock = vi.fn(
    async (_url: string, init?: RequestInit) =>
      new Response(
        JSON.stringify({
          v: 1,
          batchId: (JSON.parse(String(init?.body)) as ChannelMark).batch.id,
          accepted: ['r1', 'r1'],
          trimmed: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('collect: tracker batch', () => {
  let collector: Collector | undefined;
  let items: { el: Element; comment: string }[];

  beforeEach(() => {
    document.body.innerHTML = '<button id="b">Save</button><a id="c">Go</a>';
    items = [
      { el: document.getElementById('b')!, comment: 'one' },
      { el: document.getElementById('c')!, comment: 'two' },
    ];
  });

  afterEach(() => {
    collector?.dispose();
    collector = undefined;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('files a tracker batch by POST to the endpoint although the page has a channel and leaves the channel untouched', async () => {
    const fetchMock = stubRelay();
    const { hot, sent } = fakeHot();
    collector = collect({ win: window, hot, endpoint: '/passback', onStatus: () => {} });
    const result = await collector.sendBatch!(items, { dest: 'tracker' });
    expect(result).toEqual({ ok: true, ids: ['r1', 'r1'], trimmed: [false, false] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/passback');
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as ChannelMark;
    expect(body.batch.marks).toHaveLength(2);
    expect(body.batch.filing).toBe('one');
    expect(sent).toHaveLength(0);
  });

  it('answers a network failure and sends nothing when a tracker batch has no endpoint', async () => {
    const fetchMock = stubRelay();
    const { hot, sent } = fakeHot();
    collector = collect({ win: window, hot, onStatus: () => {} });
    const result = await collector.sendBatch!(items, { dest: 'tracker' });
    expect(result).toEqual({
      ok: false,
      reason: 'network',
      message: 'this page has no relay endpoint to file to.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it('sends an agent batch over the channel as before when dest is agent or absent', async () => {
    const fetchMock = stubRelay();
    const { hot, sent } = fakeHot();
    collector = collect({ win: window, hot, endpoint: '/passback', onStatus: () => {} });
    expect((await collector.sendBatch!(items)).ok).toBe(true);
    expect((await collector.sendBatch!(items, { dest: 'agent' })).ok).toBe(true);
    expect(sent).toHaveLength(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('turns a throw while filing into a rejected result', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const create = vi.mocked(transportModule.createTransport);
    const { hot } = fakeHot();
    collector = collect({ win: window, hot, endpoint: '/passback', onStatus: () => {} });
    // The collector's own transport is already built; the next createTransport call is the relay's.
    create.mockImplementationOnce(() => ({
      send: vi.fn(),
      sendBatch: vi.fn(async () => {
        throw new Error('exploded');
      }),
      dispose: vi.fn(),
    }));
    const result = await collector.sendBatch!(items, { dest: 'tracker' });
    expect(result).toEqual({ ok: false, reason: 'rejected', message: 'exploded' });
  });

  it('disposes the relay transport it created', async () => {
    const { hot } = fakeHot();
    const create = vi.mocked(transportModule.createTransport);
    collector = collect({ win: window, hot, endpoint: '/passback', onStatus: () => {} });
    const dispose = vi.fn();
    create.mockImplementationOnce(() => ({
      send: vi.fn(),
      sendBatch: vi.fn(async () => ({
        ok: true as const,
        ids: ['r1', 'r1'],
        trimmed: [false, false],
      })),
      dispose,
    }));
    await collector.sendBatch!(items, { dest: 'tracker' });
    await collector.sendBatch!(items, { dest: 'tracker' });
    expect(create).toHaveBeenCalledTimes(2);
    collector.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
