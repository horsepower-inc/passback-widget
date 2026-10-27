// acceptMark: an unknown passback:mark payload -> inbox writes + ChannelAck.

import { readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChannelAck, parsePayload } from '@passback/schema';
import type { Batch, Payload } from '@passback/schema';
import { parse } from '@passback/inbox';
import { acceptMark } from './accept-mark';
import { FileInboxAdapter } from './file-inbox-adapter';
import type { Ref, TrackerAdapter } from './tracker-adapter';

const BATCH_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const BATCH_CREATED_AT = '2026-09-19T14:00:00.000Z';

function firstPayload(): Payload {
  const dir = fileURLToPath(new URL('../../../fixtures/payloads/', import.meta.url));
  const file = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()[0]!;
  return parsePayload(JSON.parse(readFileSync(path.join(dir, file), 'utf8')));
}

const payload = firstPayload();

function markBytes(mark: Payload): number {
  return Buffer.byteLength(JSON.stringify(mark), 'utf8');
}

function oversizedPayload(): Payload {
  return { ...payload, intent: { ...payload.intent, comment: 'x'.repeat(60 * 1024) } };
}

function payloadOfExactSize(size: number): Payload {
  const base: Payload = { ...payload, intent: { ...payload.intent, comment: '' } };
  const deficit = size - markBytes(base);
  return parsePayload({ ...base, intent: { ...base.intent, comment: 'x'.repeat(deficit) } });
}

function batchOf(count: number): Batch {
  return {
    schemaVersion: 1,
    id: BATCH_ID,
    createdAt: BATCH_CREATED_AT,
    marks: Array.from({ length: count }, () => payload),
  };
}

type Call =
  | { fn: 'createParent'; batch: Batch }
  | { fn: 'createIssue'; payload: Payload; opts?: { parent?: Ref } };

function fakeAdapter(opts: { failOn?: 'createParent' | 'createIssue'; failAt?: number } = {}): {
  adapter: TrackerAdapter;
  calls: Call[];
} {
  const calls: Call[] = [];
  let issueCount = 0;

  const adapter: TrackerAdapter = {
    async createParent(batch) {
      calls.push({ fn: 'createParent', batch });
      if (opts.failOn === 'createParent') throw new Error('disk is full');
      return { id: 'parent-1' };
    },
    async createIssue(issuePayload, issueOpts) {
      issueCount += 1;
      calls.push({ fn: 'createIssue', payload: issuePayload, opts: issueOpts });
      if (
        opts.failOn === 'createIssue' &&
        (opts.failAt === undefined || opts.failAt === issueCount)
      ) {
        throw new Error('disk is full');
      }
      return { id: `issue-${issueCount}` };
    },
    async attach() {},
    onStatusChange() {
      return () => {};
    },
  };

  return { adapter, calls };
}

describe('acceptMark', () => {
  it('rejects malformed input with an error ack and empty accepted', async () => {
    const { adapter, calls } = fakeAdapter();
    const ack = await acceptMark(adapter, {
      v: 1,
      batch: { schemaVersion: 1, id: BATCH_ID, createdAt: BATCH_CREATED_AT, marks: [] },
    });

    expect(ack.error?.code).toBe('bad_request');
    expect(ack.accepted).toEqual([]);
    expect(ack.trimmed).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('echoes the batch id on bad input when readable', async () => {
    const { adapter } = fakeAdapter();
    const ack = await acceptMark(adapter, {
      v: 1,
      batch: { schemaVersion: 1, id: BATCH_ID, createdAt: BATCH_CREATED_AT, marks: [] },
    });

    expect(ack.batchId).toBe(BATCH_ID);

    const unreadable = await acceptMark(adapter, { v: 1, batch: { id: 42 } });
    expect(unreadable.batchId).toBe('00000000000000000000000000');

    const missing = await acceptMark(adapter, 'not an object');
    expect(missing.batchId).toBe('00000000000000000000000000');
  });

  it('echoes only a ULID batch id on bad input', async () => {
    const { adapter } = fakeAdapter();
    const ack = await acceptMark(adapter, { v: 1, batch: { id: 'not-a-ulid' } });

    expect(ack.batchId).toBe('00000000000000000000000000');
    expect(ChannelAck.safeParse(ack).success).toBe(true);
  });

  it('writes a batch of one without a parent', async () => {
    const { adapter, calls } = fakeAdapter();
    const batch = batchOf(1);
    const ack = await acceptMark(adapter, { v: 1, batch });

    expect(ack.error).toBeUndefined();
    expect(ack.batchId).toBe(batch.id);
    expect(ack.accepted).toEqual(['issue-1']);
    expect(calls).toEqual([{ fn: 'createIssue', payload: payload, opts: undefined }]);
  });

  describe('FileInboxAdapter', () => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(path.join(os.tmpdir(), 'passback-accept-mark-'));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('gives a FileInboxAdapter the batch id as batchId for a batch of one', async () => {
      const adapter = new FileInboxAdapter({ root: dir });
      const batch = batchOf(1);
      const ack = await acceptMark(adapter, { v: 1, batch });

      expect(ack.error).toBeUndefined();
      const text = await readFile(path.join(dir, `${ack.accepted[0]}.md`), 'utf8');
      expect(parse(text).batchId).toBe(batch.id);
    });
  });

  it('writes a batch of many with a parent and returns ids in order', async () => {
    const { adapter, calls } = fakeAdapter();
    const batch = batchOf(3);
    const ack = await acceptMark(adapter, { v: 1, batch });

    expect(ack.error).toBeUndefined();
    expect(ack.accepted).toEqual(['issue-1', 'issue-2', 'issue-3']);
    expect(calls[0]).toEqual({ fn: 'createParent', batch });
    expect(calls.slice(1)).toEqual([
      { fn: 'createIssue', payload, opts: { parent: { id: 'parent-1' } } },
      { fn: 'createIssue', payload, opts: { parent: { id: 'parent-1' } } },
      { fn: 'createIssue', payload, opts: { parent: { id: 'parent-1' } } },
    ]);
  });

  it('write failure gives error and empty accepted', async () => {
    const { adapter: parentFails } = fakeAdapter({ failOn: 'createParent' });
    const parentAck = await acceptMark(parentFails, { v: 1, batch: batchOf(3) });
    expect(parentAck.error?.code).toBe('write_failed');
    expect(parentAck.error?.message).toBe('disk is full');
    expect(parentAck.accepted).toEqual([]);
    expect(parentAck.batchId).toBe(BATCH_ID);

    const { adapter: secondIssueFails } = fakeAdapter({ failOn: 'createIssue', failAt: 2 });
    const issueAck = await acceptMark(secondIssueFails, { v: 1, batch: batchOf(3) });
    expect(issueAck.error?.code).toBe('write_failed');
    expect(issueAck.accepted).toEqual([]);

    const { adapter: nonErrorThrow } = fakeAdapter();
    nonErrorThrow.createIssue = async () => {
      throw 'oops';
    };
    const nonErrorAck = await acceptMark(nonErrorThrow, { v: 1, batch: batchOf(1) });
    expect(nonErrorAck.error?.code).toBe('write_failed');
    expect(nonErrorAck.error?.message).toBe('oops');
  });

  it('never throws on null, undefined or string input', async () => {
    const { adapter, calls } = fakeAdapter();

    for (const input of [
      null,
      undefined,
      'a string',
      42,
      [],
      {
        batch: {
          get id(): string {
            throw new Error('boom');
          },
        },
      },
    ]) {
      await expect(acceptMark(adapter, input)).resolves.toMatchObject({
        v: 1,
        accepted: [],
        trimmed: [],
      });
    }
    expect(calls).toEqual([]);
  });

  it('rejects a mark over 50 KB with payload_too_large and writes nothing', async () => {
    const { adapter, calls } = fakeAdapter();
    const batch: Batch = { ...batchOf(1), marks: [oversizedPayload()] };
    const ack = await acceptMark(adapter, { v: 1, batch });

    expect(ack.error?.code).toBe('payload_too_large');
    expect(ack.accepted).toEqual([]);
    expect(calls).toEqual([]);
    expect(ChannelAck.safeParse(ack).success).toBe(true);
  });

  it('accepts a mark of exactly 50 KB', async () => {
    const { adapter } = fakeAdapter();
    const atLimit = payloadOfExactSize(50 * 1024);
    expect(markBytes(atLimit)).toBe(50 * 1024);
    const batch: Batch = { ...batchOf(1), marks: [atLimit] };
    const ack = await acceptMark(adapter, { v: 1, batch });

    expect(ack.error).toBeUndefined();
    expect(ack.accepted).toEqual(['issue-1']);
  });

  it('trimmed is a subset of accepted', async () => {
    const { adapter: okAdapter } = fakeAdapter();
    const okAck = await acceptMark(okAdapter, { v: 1, batch: batchOf(3) });
    expect(okAck.trimmed.every((id) => okAck.accepted.includes(id))).toBe(true);
    expect(okAck.trimmed).toEqual([]);

    const { adapter: failAdapter } = fakeAdapter({ failOn: 'createIssue' });
    const failAck = await acceptMark(failAdapter, { v: 1, batch: batchOf(1) });
    expect(failAck.trimmed.every((id) => failAck.accepted.includes(id))).toBe(true);
  });
});
