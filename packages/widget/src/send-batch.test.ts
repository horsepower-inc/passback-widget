// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { Screenshot } from '@passback/schema';
import type { Collector } from './collect';
import type { SubmitDetail } from './overlay-submit';
import type { ShotOutcome } from './shot-loader';
import type { ShotStep } from './shot-step';
import { sendBatch, type BatchOutcome } from './send-batch';

const shot: Screenshot = {
  id: 'a'.repeat(32),
  mime: 'image/webp',
  width: 1,
  height: 1,
  bytes: 1,
  masked: 0,
};
const detailOf = (comment: string): SubmitDetail => ({
  comment,
  selector: 'div',
  offset: { x: 1, y: 1 },
  element: document.createElement('div'),
});
const stepOf = (outcomes: ShotOutcome[]): ShotStep =>
  ({ finishAll: vi.fn(async () => outcomes) }) as unknown as ShotStep;
const collectorOf = (sendBatchFn?: Collector['sendBatch'], relay = true): Collector =>
  ({ relay, sendBatch: sendBatchFn }) as unknown as Collector;

function run(collector: () => Promise<Collector>, step = stepOf([{}, {}])) {
  const settle = vi.fn<(outcome: BatchOutcome) => void>();
  const details = [detailOf('one'), detailOf('two')];
  return sendBatch({ details, settle }, collector, step).then(() => ({ settle, details }));
}

describe('sendBatch', () => {
  it('settles with the ids, trimmed flags and picture notes of one batch send', async () => {
    const batch = vi.fn<NonNullable<Collector['sendBatch']>>(async () => ({
      ok: true,
      ids: ['m1', 'm1'],
      trimmed: [false, true],
    }));
    const step = stepOf([{ screenshot: shot }, { note: 'Screenshot not attached' }]);
    const { settle, details } = await run(async () => collectorOf(batch), step);
    expect(batch).toHaveBeenCalledExactlyOnceWith([
      { el: details[0]!.element, comment: 'one', extra: { screenshot: shot } },
      { el: details[1]!.element, comment: 'two' },
    ]);
    expect(settle).toHaveBeenCalledExactlyOnceWith({
      ok: true,
      ids: ['m1', 'm1'],
      trimmed: [false, true],
      notes: [undefined, 'Screenshot not attached'],
      relay: true,
    });
  });

  it('settles a failure when the collector cannot load', async () => {
    const { settle } = await run(() => Promise.reject(new Error('offline')));
    expect(settle).toHaveBeenCalledExactlyOnceWith({
      ok: false,
      message: 'Passback could not finish loading.',
    });
  });

  it('settles a failure when the collector has no sendBatch', async () => {
    const { settle } = await run(async () => collectorOf(undefined));
    expect(settle).toHaveBeenCalledExactlyOnceWith({
      ok: false,
      message: 'Passback could not finish loading.',
    });
  });

  it('settles a refused batch with its message', async () => {
    const refused = async () => ({
      ok: false as const,
      reason: 'rejected' as const,
      message: 'no',
    });
    const { settle } = await run(async () => collectorOf(refused));
    expect(settle).toHaveBeenCalledExactlyOnceWith({ ok: false, message: 'no' });
  });

  it('settles exactly once when the send throws', async () => {
    const { settle } = await run(async () =>
      collectorOf(async () => {
        throw new Error('exploded');
      }),
    );
    expect(settle).toHaveBeenCalledExactlyOnceWith({ ok: false, message: 'exploded' });
  });
});
