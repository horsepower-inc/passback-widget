import { destOf } from './kept';
import { draftText } from './overlay-draw';
import { retrySubmit, type SubmitCtx } from './overlay-submit';

type FlushCtx = SubmitCtx & { panel?: { reveal?(): void } };
type Batch = 'rest' | 'pending' | 'failed';
type Port = { batch(): Batch; open(): boolean; start(dest: 'agent' | 'tracker'): void };
type Asked = { flush?(ok: boolean): void; taken?: boolean; draft?: boolean };

export type Flush = {
  /** True when the event was a review session's flush and is now answered through its callback. */
  take(event: Event): boolean;
  /** Each state change of the overlay; a flush waits here for the send it is behind. */
  wake(): void;
  stop(): void;
};

/** The review session's flush: every unsent comment through its own send path, true only once none is left. */
export function reviewFlush(ctx: FlushCtx, port: Port): Flush {
  const { state } = ctx;
  const waiting: (() => void)[] = [];
  let stopped = false;
  const busy = (): boolean => port.batch() === 'pending' || state.submitting;
  const settled = (): Promise<void> =>
    new Promise((resolve) => (busy() && !stopped ? waiting.push(resolve) : resolve()));
  const release = (): void => waiting.splice(0).forEach((resume) => resume());

  const retryFailedSingle = async (): Promise<boolean> => {
    if (state.flow !== 'sending' || port.batch() !== 'rest') return true;
    retrySubmit(ctx);
    await settled();
    return state.flow !== 'sending';
  };
  const sendKept = async (dest: 'agent' | 'tracker'): Promise<boolean> => {
    if (!state.kept.items.some((item) => destOf(item) === dest)) return true;
    if (!port.open()) ctx.panel?.reveal?.();
    port.start(dest);
    await settled();
    return port.batch() !== 'failed';
  };
  const run = async (asked: Asked): Promise<boolean> => {
    await settled();
    if (state.phase === 'composing' && draftText(ctx) !== '') {
      asked.draft = true;
      return false;
    }
    const sent =
      (await retryFailedSingle()) && (await sendKept('agent')) && (await sendKept('tracker'));
    return sent && !stopped && state.kept.items.length === 0;
  };

  return {
    take(event) {
      const asked = (event as CustomEvent<Asked | null>).detail;
      const answer = asked?.flush;
      if (!answer) return false;
      asked.taken = true;
      void run(asked).then(answer, () => answer(false));
      return true;
    },
    wake() {
      if (!busy()) release();
    },
    stop() {
      stopped = true;
      release();
    },
  };
}
