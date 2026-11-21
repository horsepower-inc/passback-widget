import { describe, expect, it, vi } from 'vitest';
import { createChannel, safePrUrl, sendOrphaned, type Hot } from './channel';
import type { Batch, ChannelAck, ChannelStatus } from '@passback/schema';

type FakeHot = Hot & {
  handlers: Map<string, Set<(data: unknown) => void>>;
  sent: Array<{ event: string; data: unknown }>;
  emit(event: string, data: unknown): void;
};

function fakeHot(): FakeHot {
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  const sent: Array<{ event: string; data: unknown }> = [];
  return {
    handlers,
    sent,
    send(event, data) {
      sent.push({ event, data });
    },
    on(event, cb) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)?.add(cb);
    },
    off(event, cb) {
      handlers.get(event)?.delete(cb);
    },
    emit(event, data) {
      for (const cb of handlers.get(event) ?? []) cb(data);
    },
  };
}

function fakeBatch(): Batch {
  return {
    schemaVersion: 1,
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    createdAt: '2026-09-29T00:00:00.000Z',
    marks: [],
  } as unknown as Batch;
}

function fakeAck(): ChannelAck {
  return { v: 1, batchId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', accepted: [], trimmed: [] };
}

function fakeStatus(): ChannelStatus {
  return {
    v: 1,
    markId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    state: 'done',
    at: '2026-09-29T00:00:00.000Z',
  };
}

describe('createChannel', () => {
  it('sends a v1 mark with the batch', () => {
    const hot = fakeHot();
    const channel = createChannel(hot, { onAck: () => {}, onStatus: () => {} });
    const batch = fakeBatch();

    const result = channel.sendMark(batch);

    expect(result).toBe(true);
    expect(hot.sent).toEqual([{ event: 'passback:mark', data: { v: 1, batch } }]);
  });

  it('reports unavailable and sends nothing without hot', () => {
    const channel = createChannel(undefined, { onAck: () => {}, onStatus: () => {} });

    const result = channel.sendMark(fakeBatch());

    expect(channel.available).toBe(false);
    expect(result).toBe(false);
  });

  it('routes an ack to onAck', () => {
    const hot = fakeHot();
    const onAck = vi.fn();
    createChannel(hot, { onAck, onStatus: () => {} });
    const ack = fakeAck();

    hot.emit('passback:ack', ack);

    expect(onAck).toHaveBeenCalledWith(ack);
  });

  it('routes a status to onStatus', () => {
    const hot = fakeHot();
    const onStatus = vi.fn();
    createChannel(hot, { onAck: () => {}, onStatus });
    const status = fakeStatus();

    hot.emit('passback:status', status);

    expect(onStatus).toHaveBeenCalledWith(status);
  });

  it('a throwing handler does not escape', () => {
    const hot = fakeHot();
    createChannel(hot, {
      onAck: () => {
        throw new Error('boom');
      },
      onStatus: () => {
        throw new Error('boom');
      },
    });

    expect(() => {
      hot.emit('passback:ack', fakeAck());
      hot.emit('passback:status', fakeStatus());
    }).not.toThrow();
  });

  it('stops delivering after dispose', () => {
    const hot = fakeHot();
    const onAck = vi.fn();
    const onStatus = vi.fn();
    const channel = createChannel(hot, { onAck, onStatus });

    channel.dispose();
    hot.emit('passback:ack', fakeAck());
    hot.emit('passback:status', fakeStatus());

    expect(onAck).not.toHaveBeenCalled();
    expect(onStatus).not.toHaveBeenCalled();
    expect(hot.handlers.get('passback:ack')?.size ?? 0).toBe(0);
    expect(hot.handlers.get('passback:status')?.size ?? 0).toBe(0);
  });

  it('sendOrphaned sends one passback:orphaned message with v 1 and the ids', () => {
    const hot = fakeHot();

    const result = sendOrphaned(hot, ['a', 'b']);

    expect(result).toBe(true);
    expect(hot.sent).toEqual([{ event: 'passback:orphaned', data: { v: 1, markIds: ['a', 'b'] } }]);
  });

  it('sendOrphaned splits more than 20 ids into messages of at most 20', () => {
    const hot = fakeHot();
    const ids = Array.from({ length: 45 }, (_, i) => `m${i}`);

    const result = sendOrphaned(hot, ids);

    const chunks = hot.sent.map((m) => (m.data as { markIds: string[] }).markIds);
    expect(result).toBe(true);
    expect(chunks.map((c) => c.length)).toEqual([20, 20, 5]);
    expect(chunks.flat()).toEqual(ids);
  });

  it('sendOrphaned sends nothing for an empty list or without a hot', () => {
    const hot = fakeHot();

    expect(sendOrphaned(hot, [])).toBe(false);
    expect(sendOrphaned(undefined, ['a'])).toBe(false);
    expect(hot.sent).toEqual([]);
  });

  it('sendOrphaned swallows a throwing hot.send and returns false', () => {
    const hot = {
      send() {
        throw new Error('socket down');
      },
    };

    expect(sendOrphaned(hot, ['a'])).toBe(false);
  });

  it('safePrUrl keeps http and https', () => {
    expect(safePrUrl('http://example.com/pr/1')).toBe('http://example.com/pr/1');
    expect(safePrUrl('https://example.com/pr/1')).toBe('https://example.com/pr/1');
  });

  it('safePrUrl rejects javascript, data, garbage and undefined', () => {
    expect(safePrUrl('javascript:alert(1)')).toBeUndefined();
    expect(safePrUrl('data:text/html,<script>alert(1)</script>')).toBeUndefined();
    expect(safePrUrl('not a url')).toBeUndefined();
    expect(safePrUrl('')).toBeUndefined();
    expect(safePrUrl(undefined)).toBeUndefined();
  });
});
