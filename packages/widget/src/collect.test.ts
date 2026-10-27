// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Annotation, ChannelMark, Screenshot } from '@passback/schema';
import type { Hot } from './channel';
import { collect } from './collect';
import type { Collector } from './collect';

type FakeHot = Hot & {
  sent: Array<{ event: string; data: unknown }>;
  trigger(event: string, data: unknown): void;
};

function fakeHot(): FakeHot {
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  const sent: Array<{ event: string; data: unknown }> = [];
  const hot: FakeHot = {
    sent,
    send(event, data) {
      sent.push({ event, data });
      const { batch } = data as ChannelMark;
      hot.trigger('passback:ack', {
        v: 1,
        batchId: batch.id,
        accepted: batch.marks.map(() => 'mark-1'),
        trimmed: [],
      });
    },
    on(event, cb) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)?.add(cb);
    },
    off(event, cb) {
      handlers.get(event)?.delete(cb);
    },
    trigger(event, data) {
      for (const cb of handlers.get(event) ?? []) cb(data);
    },
  };
  return hot;
}

function lastBatch(hot: FakeHot): ChannelMark['batch'] {
  return (hot.sent[hot.sent.length - 1]?.data as ChannelMark).batch;
}

describe('collect', () => {
  let collector: Collector | undefined;
  let button: HTMLButtonElement;

  beforeEach(() => {
    document.body.innerHTML = '<button id="b">Save</button>';
    button = document.getElementById('b') as HTMLButtonElement;
  });

  afterEach(() => {
    collector?.dispose();
    collector = undefined;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.location.hash = '';
    window.sessionStorage.clear();
  });

  it('sends the assembled payload over hot as a one-mark batch and resolves with the acked id', async () => {
    const hot = fakeHot();
    collector = collect({ win: window, hot, onStatus: () => {} });
    const result = await collector.send(button, 'Broken');
    expect(result).toEqual({ ok: true, id: 'mark-1', trimmed: false });
    expect(hot.sent).toHaveLength(1);
    expect(hot.sent[0]?.event).toBe('passback:mark');
    const batch = lastBatch(hot);
    expect(batch.marks).toHaveLength(1);
    expect(batch.marks[0]?.element.tag).toBe('button');
  });

  it('puts the comment into the payload intent', async () => {
    const hot = fakeHot();
    collector = collect({ win: window, hot, onStatus: () => {} });
    await collector.send(button, 'The label is cut off');
    expect(lastBatch(hot).marks[0]?.intent.comment).toBe('The label is cut off');
  });

  it('adds the screenshot metadata to the payload it sends', async () => {
    const hot = fakeHot();
    collector = collect({ win: window, hot, onStatus: () => {} });
    const screenshot: Screenshot = {
      id: '0123456789abcdef0123456789abcdef',
      mime: 'image/webp',
      width: 1280,
      height: 720,
      bytes: 12000,
      masked: 2,
    };
    await collector.send(button, 'Broken', { screenshot });
    expect(lastBatch(hot).marks[0]?.screenshot).toEqual(screenshot);
    // sends no screenshot key when none is given
    await collector.send(button, 'Broken');
    expect(lastBatch(hot).marks[0]).not.toHaveProperty('screenshot');
  });

  it('puts the drawn annotations into intent.annotations', async () => {
    const hot = fakeHot();
    collector = collect({ win: window, hot, onStatus: () => {} });
    const annotations: Annotation[] = [
      { type: 'arrow', from: { x: 10, y: 20 }, to: { x: 100, y: 120 } },
      { type: 'box', from: { x: 30, y: 40 }, to: { x: 80, y: 90 } },
    ];
    await collector.send(button, 'Broken', { annotations });
    expect(lastBatch(hot).marks[0]?.intent).toEqual({ comment: 'Broken', annotations });
    // keeps intent.annotations empty when none are given
    await collector.send(button, 'Broken');
    expect(lastBatch(hot).marks[0]?.intent.annotations).toEqual([]);
    await collector.send(button, 'Broken', { annotations: [] });
    expect(lastBatch(hot).marks[0]?.intent.annotations).toEqual([]);
  });

  it('records the timeline from creation, so an earlier click is in the payload', async () => {
    const hot = fakeHot();
    collector = collect({ win: window, hot, onStatus: () => {} });
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await collector.send(button, 'x');
    expect(
      lastBatch(hot).marks[0]?.timeline.some((e) => e.kind === 'action' && e.type === 'click'),
    ).toBe(true);
  });

  it('POSTs the batch to the endpoint when there is no hot', async () => {
    const fetchMock = vi.fn(
      async (_url: string, init?: RequestInit) =>
        new Response(
          JSON.stringify({
            v: 1,
            batchId: (JSON.parse(String(init?.body)) as { id: string }).id,
            accepted: ['mark-2'],
            trimmed: [],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    collector = collect({ win: window, endpoint: '/passback', onStatus: () => {} });
    const result = await collector.send(button, 'x');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/passback');
    expect(result.ok).toBe(true);
  });

  function postedBatch(): {
    fetchMock: ReturnType<typeof vi.fn>;
    body(): { batch: Record<string, unknown> };
  } {
    const fetchMock = vi.fn(
      async (_url: string, init?: RequestInit) =>
        new Response(
          JSON.stringify({
            v: 1,
            batchId: (JSON.parse(String(init?.body)) as { batch: { id: string } }).batch.id,
            accepted: ['mark-2'],
            trimmed: [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    return {
      fetchMock,
      body: () => JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    };
  }

  it('POSTs the pull request number of the review link with the batch', async () => {
    window.location.hash = '#pb-pr104';
    const { body } = postedBatch();
    collector = collect({ win: window, endpoint: '/passback', onStatus: () => {} });
    await collector.send(button, 'x');
    expect(body().batch.pullRequest).toBe(104);
  });

  it('POSTs no pullRequest key from a tab with no review link', async () => {
    const { body } = postedBatch();
    collector = collect({ win: window, endpoint: '/passback', onStatus: () => {} });
    await collector.send(button, 'x');
    expect(Object.hasOwn(body().batch, 'pullRequest')).toBe(false);
  });

  it('resolves a network failure without calling fetch when there is neither hot nor an endpoint', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    collector = collect({ win: window, onStatus: () => {} });
    const result = await collector.send(button, 'x');
    expect(result).toEqual({
      ok: false,
      reason: 'network',
      message: 'no HMR channel and no endpoint to POST to',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('relays passback:status events to onStatus', () => {
    const hot = fakeHot();
    const onStatus = vi.fn();
    collector = collect({ win: window, hot, onStatus });
    const status = { v: 1, batchId: 'b', markId: 'm', state: 'queued' };
    hot.trigger('passback:status', status);
    expect(onStatus).toHaveBeenCalledWith(status);
  });

  it('dispose stops the timeline and the transport', async () => {
    const hot = fakeHot();
    const onStatus = vi.fn();
    const originalLog = window.console.error;
    collector = collect({ win: window, hot, onStatus });
    expect(window.console.error).not.toBe(originalLog);
    collector.dispose();
    collector.dispose();
    expect(window.console.error).toBe(originalLog);
    hot.trigger('passback:status', { v: 1 });
    expect(onStatus).not.toHaveBeenCalled();
    const result = await collector.send(button, 'x');
    expect(result.ok).toBe(false);
  });

  it('sendBatch assembles one payload per item and sends them as one batch', async () => {
    const hot = fakeHot();
    collector = collect({ win: window, hot, onStatus: () => {} });
    const other = document.body.appendChild(document.createElement('a'));
    const screenshot: Screenshot = {
      id: '0123456789abcdef0123456789abcdef',
      mime: 'image/webp',
      width: 1280,
      height: 720,
      bytes: 12000,
      masked: 0,
    };
    const annotations: Annotation[] = [{ type: 'box', from: { x: 1, y: 2 }, to: { x: 3, y: 4 } }];
    const result = await collector.sendBatch!([
      { el: button, comment: 'one', extra: { screenshot } },
      { el: other, comment: 'two', extra: { annotations } },
    ]);
    expect(result.ok).toBe(true);
    expect(hot.sent).toHaveLength(1);
    const { marks } = lastBatch(hot);
    expect(marks.map((mark) => mark.intent.comment)).toEqual(['one', 'two']);
    expect(marks[0]?.element.tag).toBe('button');
    expect(marks[0]?.screenshot).toEqual(screenshot);
    expect(marks[1]).not.toHaveProperty('screenshot');
    expect(marks[1]?.intent.annotations).toEqual(annotations);
  });

  it('sendBatch fails like send when there is neither a channel nor an endpoint', async () => {
    collector = collect({ win: window, onStatus: () => {} });
    const result = await collector.sendBatch!([{ el: button, comment: 'x' }]);
    expect(result).toEqual({
      ok: false,
      reason: 'network',
      message: 'no HMR channel and no endpoint to POST to',
    });
  });

  it('registers itself as window.__passback.collect and keeps the other __passback keys', async () => {
    const scope = globalThis as { __passback?: Record<string, unknown> };
    scope.__passback = { buildId: 'b1', hot: 'h' };
    vi.resetModules();
    const fresh = await import('./collect');
    expect(scope.__passback?.collect).toBe(fresh.collect);
    expect(scope.__passback?.buildId).toBe('b1');
    expect(scope.__passback?.hot).toBe('h');
    delete scope.__passback;
  });
});
