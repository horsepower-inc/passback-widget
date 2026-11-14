import type { ResolveTarget } from '@passback/collectors';
import type { Annotation } from '@passback/schema';
import { sendVerified, type Hot } from './channel';

type Verdict = 'closed' | 'open' | 'unchecked';
type Row = { id: string; annotations: Annotation[] };

export type VerifyOptions = {
  hot: Hot | undefined;
  caps: unknown;
  marks(): readonly { id: string; target: ResolveTarget }[];
  measure(target: ResolveTarget, annotations: readonly Annotation[]): Verdict;
};

/** Sends passback:verified for proposed marks of this page load whose geometry annotations hold. Never throws. */
export function startVerify(opts: VerifyOptions): { run(): void; stop(): void } {
  const { hot, caps, marks, measure } = opts;
  if (!hot || !Array.isArray(caps) || !caps.includes('verified')) return { run() {}, stop() {} };
  let kept: Row[] = [];
  const sent = new Set<string>();

  function run(): void {
    quiet(() => {
      const open = new Map(marks().map((m) => [m.id, m.target]));
      const ids: string[] = [];
      for (const row of kept) {
        const target = open.get(row.id);
        if (target === undefined || sent.has(row.id)) continue;
        if (measure(target, row.annotations) === 'closed') ids.push(row.id);
      }
      if (ids.length > 0 && sendVerified(hot, ids)) ids.forEach((id) => sent.add(id));
    });
  }

  function onItems(data: unknown): void {
    quiet(() => {
      const msg = data as { v?: unknown; items?: unknown } | null;
      if (msg?.v !== 1 || !Array.isArray(msg.items)) return;
      kept = (msg.items as Partial<Row & { status: string }>[])
        .filter(
          (i): i is Row =>
            i?.status === 'proposed' &&
            typeof i.id === 'string' &&
            Array.isArray(i.annotations) &&
            i.annotations.length > 0,
        )
        .map((i) => ({ id: i.id, annotations: i.annotations }));
      run();
    });
  }

  // a hot object that refuses the subscription leaves kept empty, so run sends nothing
  quiet(() => hot.on('passback:items', onItems));
  return { run, stop: () => quiet(() => hot.off?.('passback:items', onItems)) };
}

function quiet(f: () => void): void {
  try {
    f();
  } catch {
    // the overlay never throws into the host page
  }
}
