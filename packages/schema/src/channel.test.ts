import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CHANNEL_EVENTS,
  ChannelAck,
  ChannelAnswer,
  ChannelMark,
  ChannelOrphaned,
  ChannelReopen,
  ChannelStatus,
  MarkState,
} from './index';

const dir = fileURLToPath(new URL('../../../fixtures/payloads/', import.meta.url));
const marks = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(dir + f, 'utf8')) as unknown);

const ulid = '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ8';
const ulid2 = '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ9';

function batch(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    id: ulid,
    createdAt: '2026-09-19T14:00:00Z',
    marks,
    ...overrides,
  };
}

describe('channel', () => {
  it('names the eleven channel events including clear and cleared', () => {
    expect(CHANNEL_EVENTS).toEqual({
      mark: 'passback:mark',
      ack: 'passback:ack',
      status: 'passback:status',
      orphaned: 'passback:orphaned',
      reopen: 'passback:reopen',
      answer: 'passback:answer',
      list: 'passback:list',
      items: 'passback:items',
      verdict: 'passback:verdict',
      clear: 'passback:clear',
      cleared: 'passback:cleared',
    });
  });

  it('parses a passback:answer message and trims its text', () => {
    expect(ChannelAnswer.parse({ v: 1, markId: ulid, text: '  the blue one  ' })).toEqual({
      v: 1,
      markId: ulid,
      text: 'the blue one',
    });
    expect(() => ChannelAnswer.parse({ v: 1, markId: ulid, text: 'x'.repeat(4000) })).not.toThrow();
  });

  it('rejects a passback:answer message with a blank text, a text over 4000 characters, a non-ULID id, or v other than 1', () => {
    expect(() => ChannelAnswer.parse({ v: 1, markId: ulid, text: '   ' })).toThrow();
    expect(() => ChannelAnswer.parse({ v: 1, markId: ulid, text: 'x'.repeat(4001) })).toThrow();
    expect(() => ChannelAnswer.parse({ v: 1, markId: 'not-a-ulid', text: 'no' })).toThrow();
    expect(() => ChannelAnswer.parse({ v: 2, markId: ulid, text: 'no' })).toThrow();
  });

  it('parses a passback:reopen message and trims its comment', () => {
    expect(ChannelReopen.parse({ v: 1, markId: ulid, comment: '  still wrong  ' })).toEqual({
      v: 1,
      markId: ulid,
      comment: 'still wrong',
    });
    expect(() =>
      ChannelReopen.parse({ v: 1, markId: ulid, comment: 'x'.repeat(4000) }),
    ).not.toThrow();
  });

  it('rejects a passback:reopen message with a blank comment, a comment over 4000 characters, a non-ULID id, or v other than 1', () => {
    expect(() => ChannelReopen.parse({ v: 1, markId: ulid, comment: '   ' })).toThrow();
    expect(() => ChannelReopen.parse({ v: 1, markId: ulid, comment: 'x'.repeat(4001) })).toThrow();
    expect(() => ChannelReopen.parse({ v: 1, markId: 'not-a-ulid', comment: 'no' })).toThrow();
    expect(() => ChannelReopen.parse({ v: 2, markId: ulid, comment: 'no' })).toThrow();
  });

  it('parses a passback:orphaned message naming one or more mark ids', () => {
    expect(() => ChannelOrphaned.parse({ v: 1, markIds: [ulid] })).not.toThrow();
    expect(() => ChannelOrphaned.parse({ v: 1, markIds: [ulid, ulid2] })).not.toThrow();
    expect(() =>
      ChannelOrphaned.parse({ v: 1, markIds: Array.from({ length: 20 }, () => ulid) }),
    ).not.toThrow();
  });

  it('rejects a passback:orphaned message with no ids, more than 20 ids, a non-ULID id, or v other than 1', () => {
    expect(() => ChannelOrphaned.parse({ v: 1, markIds: [] })).toThrow();
    expect(() =>
      ChannelOrphaned.parse({ v: 1, markIds: Array.from({ length: 21 }, () => ulid) }),
    ).toThrow();
    expect(() => ChannelOrphaned.parse({ v: 1, markIds: ['not-a-ulid'] })).toThrow();
    expect(() => ChannelOrphaned.parse({ v: 2, markIds: [ulid] })).toThrow();
  });

  it('parses a passback:mark message carrying a batch of one', () => {
    expect(marks.length).toBeGreaterThanOrEqual(1);
    expect(() => ChannelMark.parse({ v: 1, batch: batch({ marks: [marks[0]] }) })).not.toThrow();
  });

  it('keeps filing one on a passback:mark message', () => {
    const msg = ChannelMark.parse({ v: 1, batch: batch({ filing: 'one' }) });
    expect(msg.batch.filing).toBe('one');
  });

  it('parses a passback:ack with one accepted id per mark of a filing one batch', () => {
    const parsed = ChannelMark.parse({ v: 1, batch: batch({ filing: 'one' }) }).batch;
    expect(parsed.marks.length).toBeGreaterThanOrEqual(2);
    const accepted = parsed.marks.map(
      (_, i) => `01J8ZKZ8J8ZKZ8J8ZKZ8J8ZK${i.toString(32).padStart(2, '0').toUpperCase()}`,
    );
    expect(ChannelAck.parse({ v: 1, batchId: parsed.id, accepted, trimmed: [] }).accepted).toEqual(
      accepted,
    );
  });

  it('rejects a passback:mark message whose v is not 1', () => {
    expect(() => ChannelMark.parse({ v: 2, batch: batch() })).toThrow();
  });

  it('parses a passback:ack with accepted and trimmed mark ids', () => {
    expect(() =>
      ChannelAck.parse({ v: 1, batchId: ulid, accepted: [ulid, ulid2], trimmed: [ulid2] }),
    ).not.toThrow();
  });

  it('parses a passback:ack carrying an error', () => {
    expect(() =>
      ChannelAck.parse({
        v: 1,
        batchId: ulid,
        accepted: [],
        trimmed: [],
        error: { code: 'bad_batch', message: 'batch failed validation' },
      }),
    ).not.toThrow();
  });

  it('rejects a passback:ack whose mark id is not a ULID', () => {
    expect(() =>
      ChannelAck.parse({ v: 1, batchId: ulid, accepted: ['not-a-ulid'], trimmed: [] }),
    ).toThrow();
  });

  it('parses a passback:status in each of the four states', () => {
    for (const state of MarkState.options) {
      expect(() =>
        ChannelStatus.parse({ v: 1, markId: ulid, state, at: '2026-09-19T14:00:00Z' }),
      ).not.toThrow();
    }
  });

  it('rejects a passback:status with an unknown state', () => {
    expect(() =>
      ChannelStatus.parse({ v: 1, markId: ulid, state: 'pending', at: '2026-09-19T14:00:00Z' }),
    ).toThrow();
  });

  it('rejects a passback:status whose at is not an ISO 8601 datetime', () => {
    expect(() =>
      ChannelStatus.parse({ v: 1, markId: ulid, state: 'queued', at: 'not-a-date' }),
    ).toThrow();
  });
});
