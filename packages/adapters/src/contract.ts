// the adapterContract() suite every TrackerAdapter implementation passes.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Batch, Payload } from '@passback/schema';
import type { Attachment, Ref, TrackerAdapter, Unsubscribe } from './tracker-adapter';

export type ContractHarness = {
  setup(): Promise<TrackerAdapter>;
  teardown(): Promise<void>;
  payload: Payload;
  setStatus(ref: Ref, status: string): Promise<void>;
  attachment(name: string, content: string): Promise<Attachment>;
  settleMs: number;
  optionalMethods?: readonly ('getStatus' | 'comment')[];
};

const BATCH_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const BATCH_CREATED_AT = '2026-09-19T14:00:00.000Z';

function batchOf(payload: Payload, count: number): Batch {
  return {
    schemaVersion: 1,
    id: BATCH_ID,
    createdAt: BATCH_CREATED_AT,
    marks: Array.from({ length: count }, () => payload),
  };
}

type Ctx = { adapter: TrackerAdapter; unsubs: Unsubscribe[] };

function track(ctx: Ctx, ref: Ref): { calls: string[]; unsubscribe: Unsubscribe } {
  const calls: string[] = [];
  const unsubscribe = ctx.adapter.onStatusChange(ref, (s) => calls.push(s));
  ctx.unsubs.push(unsubscribe);
  return { calls, unsubscribe };
}

function registerCreateTests(ctx: Ctx, harness: ContractHarness): void {
  it('createIssue returns a ref with a non-empty id', async () => {
    const ref = await ctx.adapter.createIssue(harness.payload);
    expect(ref.id).toBeTruthy();
  });

  it('createIssue called twice with one payload returns two refs', async () => {
    const a = await ctx.adapter.createIssue(harness.payload);
    const b = await ctx.adapter.createIssue(harness.payload);
    expect(a.id).not.toBe(b.id);
  });

  it('concurrent createIssue calls return distinct refs', async () => {
    const refs = await Promise.all(
      Array.from({ length: 5 }, () => ctx.adapter.createIssue(harness.payload)),
    );
    expect(new Set(refs.map((r) => r.id)).size).toBe(5);
  });

  it('createParent rejects a batch of one', async () => {
    await expect(ctx.adapter.createParent(batchOf(harness.payload, 1))).rejects.toThrow();
  });

  it('createIssue accepts the ref createParent returns as parent', async () => {
    const parent = await ctx.adapter.createParent(batchOf(harness.payload, 2));
    await expect(ctx.adapter.createIssue(harness.payload, { parent })).resolves.toBeDefined();
  });
}

function registerAttachTests(ctx: Ctx, harness: ContractHarness): void {
  it('attach resolves for an issue createIssue returned', async () => {
    const ref = await ctx.adapter.createIssue(harness.payload);
    const file = await harness.attachment('note.txt', 'hello');
    await expect(ctx.adapter.attach(ref, file)).resolves.toBeUndefined();
  });

  it('attach rejects for a ref no createIssue returned', async () => {
    const file = await harness.attachment('note.txt', 'hello');
    await expect(ctx.adapter.attach({ id: 'never-created' }, file)).rejects.toThrow();
  });
}

function registerStatusTests(ctx: Ctx, harness: ContractHarness): void {
  it('onStatusChange reports an external status change', async () => {
    const ref = await ctx.adapter.createIssue(harness.payload);
    const { calls } = track(ctx, ref);
    await harness.setStatus(ref, 'ack');
    await vi.waitFor(() => expect(calls).toEqual(['ack']), { timeout: harness.settleMs });
  });

  it('onStatusChange reports each distinct status in order', async () => {
    const ref = await ctx.adapter.createIssue(harness.payload);
    const { calls } = track(ctx, ref);
    await harness.setStatus(ref, 'ack');
    await vi.waitFor(() => expect(calls).toEqual(['ack']), { timeout: harness.settleMs });
    await harness.setStatus(ref, 'proposed');
    await vi.waitFor(() => expect(calls).toEqual(['ack', 'proposed']), {
      timeout: harness.settleMs,
    });
  });

  it('onStatusChange stays silent when the same status is written again', async () => {
    const ref = await ctx.adapter.createIssue(harness.payload);
    const { calls } = track(ctx, ref);
    await harness.setStatus(ref, 'ack');
    await harness.setStatus(ref, 'ack');
    await new Promise((resolve) => setTimeout(resolve, harness.settleMs));
    expect(calls).toEqual(['ack']);

    const fresh = await ctx.adapter.createIssue(harness.payload);
    const { calls: freshCalls } = track(ctx, fresh);
    await new Promise((resolve) => setTimeout(resolve, harness.settleMs));
    expect(freshCalls).toEqual([]);
  });

  it('onStatusChange stays silent after unsubscribe', async () => {
    const ref = await ctx.adapter.createIssue(harness.payload);
    const { calls, unsubscribe } = track(ctx, ref);
    unsubscribe();
    await harness.setStatus(ref, 'ack');
    await new Promise((resolve) => setTimeout(resolve, harness.settleMs));
    expect(calls).toEqual([]);
  });

  it('calling unsubscribe twice does not throw', async () => {
    const ref = await ctx.adapter.createIssue(harness.payload);
    const { unsubscribe } = track(ctx, ref);
    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
  });
}

function registerOptionalTests(ctx: Ctx, harness: ContractHarness): void {
  const listed = harness.optionalMethods ?? [];
  const missing = { id: 'never-created' };

  if (listed.includes('getStatus')) {
    it('getStatus returns the status an external change wrote', async () => {
      const ref = await ctx.adapter.createIssue(harness.payload);
      await harness.setStatus(ref, 'ack');
      await expect(ctx.adapter.getStatus!(ref)).resolves.toBe('ack');
    });

    it('getStatus rejects for a ref no createIssue returned', async () => {
      await expect(ctx.adapter.getStatus!(missing)).rejects.toThrow();
    });
  }

  if (listed.includes('comment')) {
    it('comment resolves for an issue createIssue returned', async () => {
      const ref = await ctx.adapter.createIssue(harness.payload);
      await expect(ctx.adapter.comment!(ref, 'a note')).resolves.toBeUndefined();
    });

    it('comment rejects for a ref no createIssue returned', async () => {
      await expect(ctx.adapter.comment!(missing, 'a note')).rejects.toThrow();
    });
  }
}

export function adapterContract(name: string, harness: ContractHarness): void {
  describe(`adapterContract: ${name}`, () => {
    const ctx: Ctx = { adapter: null as unknown as TrackerAdapter, unsubs: [] };

    beforeEach(async () => {
      ctx.adapter = await harness.setup();
      ctx.unsubs = [];
    });

    afterEach(async () => {
      for (const unsubscribe of ctx.unsubs) unsubscribe();
      await harness.teardown();
    });

    registerCreateTests(ctx, harness);
    registerAttachTests(ctx, harness);
    registerStatusTests(ctx, harness);
    registerOptionalTests(ctx, harness);
  });
}
