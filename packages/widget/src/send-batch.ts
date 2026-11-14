import type { Screenshot, Annotation } from '@passback/schema';
import type { SubmitDetail } from './overlay-submit';
import type { BatchSendResult } from './send';
import { shotExtra, type ShotStep } from './shot-step';

export type BatchOutcome =
  | { ok: true; ids: string[]; trimmed: boolean[]; notes: (string | undefined)[]; relay: boolean }
  | { ok: false; message: string };

export type SubmitAllDetail = {
  details: readonly SubmitDetail[];
  dest?: 'agent' | 'tracker';
  settle(outcome: BatchOutcome): void;
};

// The part of Collector this file needs; naming Collector itself would close an import cycle through send-all.
type BatchCollector = {
  relay: boolean;
  sendBatch?(
    items: readonly {
      el: Element;
      comment: string;
      extra?: { screenshot?: Screenshot; annotations?: Annotation[] };
    }[],
    opts?: { dest: 'tracker' },
  ): Promise<BatchSendResult>;
};

/** One Send all: one picture per batch, one batch request, one outcome. */
export async function sendBatch(
  detail: SubmitAllDetail,
  load: () => Promise<BatchCollector>,
  step: ShotStep,
): Promise<void> {
  const { details } = detail;
  let outcome: BatchOutcome;
  try {
    const shots = await step.finishAll(details);
    const collector = await load().catch(() => null);
    if (!collector?.sendBatch) throw new Error('Passback could not finish loading.');
    const tracker = detail.dest === 'tracker';
    const items = details.map(({ element: el, comment }, i) => ({
      el,
      comment,
      extra: shotExtra(shots[i]!),
    }));
    const result = await (tracker
      ? collector.sendBatch(items, { dest: 'tracker' })
      : collector.sendBatch(items));
    outcome = result.ok
      ? { ...result, notes: shots.map((shot) => shot.note), relay: tracker || collector.relay }
      : { ok: false, message: result.message };
  } catch (err) {
    outcome = { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  detail.settle(outcome);
}
