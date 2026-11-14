import { describe, expect, it } from 'vitest';
import { MAX_BATCH_MARKS } from '@passback/schema';
import { BATCH_WINDOW_MS, MarkBatcher } from './batcher';

describe('MarkBatcher', () => {
  it('two marks offered 1000 ms apart close as one batch', () => {
    const batcher = new MarkBatcher();
    expect(batcher.offer('a', 0)).toBe(true);
    expect(batcher.offer('b', 1000)).toBe(true);

    expect(batcher.due(1999)).toBeUndefined();
    const batch = batcher.due(2000);
    expect(batch).toEqual({ seq: 1, ids: ['a', 'b'] });
  });

  it('due returns undefined before the window elapses', () => {
    const batcher = new MarkBatcher();
    batcher.offer('a', 0);
    expect(batcher.due(1999)).toBeUndefined();
  });

  it('due closes the batch exactly windowMs after its first mark', () => {
    const batcher = new MarkBatcher();
    batcher.offer('a', 100);
    expect(batcher.due(100 + BATCH_WINDOW_MS - 1)).toBeUndefined();
    expect(batcher.due(100 + BATCH_WINDOW_MS)).toEqual({ seq: 1, ids: ['a'] });
  });

  it('a mark offered after a batch closes starts the next batch', () => {
    const batcher = new MarkBatcher();
    batcher.offer('a', 0);
    batcher.due(2000);

    batcher.offer('b', 3000);
    expect(batcher.nextDueAt()).toBe(3000 + BATCH_WINDOW_MS);
    expect(batcher.due(3000 + BATCH_WINDOW_MS)).toEqual({ seq: 2, ids: ['b'] });
  });

  it('a batch closes early when it reaches maxMarks', () => {
    const batcher = new MarkBatcher({ maxMarks: 3 });
    batcher.offer('a', 0);
    batcher.offer('b', 10);
    batcher.offer('c', 20);

    expect(batcher.nextDueAt()).toBe(0);
    expect(batcher.due(20)).toEqual({ seq: 1, ids: ['a', 'b', 'c'] });
  });

  it('marks beyond maxMarks wait for the next batch with their own window', () => {
    const batcher = new MarkBatcher();
    const ids = Array.from({ length: 21 }, (_, i) => `mark-${i}`);
    for (const id of ids) {
      expect(batcher.offer(id, 0)).toBe(true);
    }

    const first = batcher.due(0);
    expect(first?.ids).toHaveLength(MAX_BATCH_MARKS);
    expect(first?.ids).toEqual(ids.slice(0, MAX_BATCH_MARKS));

    expect(batcher.due(BATCH_WINDOW_MS - 1)).toBeUndefined();
    const second = batcher.due(BATCH_WINDOW_MS);
    expect(second).toEqual({ seq: 2, ids: [ids[20]] });
  });

  it('offer ignores an id that is already pending', () => {
    const batcher = new MarkBatcher();
    expect(batcher.offer('a', 0)).toBe(true);
    expect(batcher.offer('a', 500)).toBe(false);
    expect(batcher.due(BATCH_WINDOW_MS)).toEqual({ seq: 1, ids: ['a'] });
  });

  it('offer ignores an id that is in flight', () => {
    const batcher = new MarkBatcher();
    batcher.offer('a', 0);
    batcher.due(BATCH_WINDOW_MS);
    expect(batcher.offer('a', BATCH_WINDOW_MS + 1)).toBe(false);
  });

  it('settle returns the ids and lets them be offered again', () => {
    const batcher = new MarkBatcher();
    batcher.offer('a', 0);
    const batch = batcher.due(BATCH_WINDOW_MS);
    expect(batcher.settle(batch!.seq)).toEqual(['a']);
    expect(batcher.offer('a', BATCH_WINDOW_MS + 1)).toBe(true);
  });

  it('settle of an unknown seq returns an empty list', () => {
    const batcher = new MarkBatcher();
    expect(batcher.settle(99)).toEqual([]);
  });

  it('batch seq numbers increase from 1', () => {
    const batcher = new MarkBatcher();
    batcher.offer('a', 0);
    const first = batcher.due(BATCH_WINDOW_MS);
    batcher.offer('b', BATCH_WINDOW_MS + 1);
    const second = batcher.due(2 * BATCH_WINDOW_MS + 1);
    expect(first?.seq).toBe(1);
    expect(second?.seq).toBe(2);
  });

  it('nextDueAt is undefined with nothing pending', () => {
    const batcher = new MarkBatcher();
    expect(batcher.nextDueAt()).toBeUndefined();
  });

  it('inFlight lists open batches in seq order', () => {
    const batcher = new MarkBatcher();
    batcher.offer('a', 0);
    const first = batcher.due(BATCH_WINDOW_MS);
    batcher.offer('b', BATCH_WINDOW_MS + 1);
    const second = batcher.due(2 * BATCH_WINDOW_MS + 1);

    expect(batcher.inFlight()).toEqual([
      { seq: first!.seq, ids: ['a'] },
      { seq: second!.seq, ids: ['b'] },
    ]);
  });
});
