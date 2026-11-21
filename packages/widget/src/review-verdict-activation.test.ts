// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ID = 'abcdefghijklmnopqrstuv2345';
const scope = window as unknown as { __passback?: Record<string, unknown> };
type Answer = { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>;
type Call = { op: string; body: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any

const comment = (id: string) => ({
  id,
  mark: `m-${id}`,
  text: `Comment ${id}`,
  label: 'k-bug',
  status: 'open',
  tone: 'plain',
  overruled: false,
});
const SESSION = {
  v: 1,
  state: 'open',
  title: 'Cart review',
  version: 'rc3',
  round: 2,
  check: 'Does it fit?',
  labels: [{ key: 'k-bug', label: 'Bug' }],
  comments: [comment('c-1'), comment('c-2')],
  fixes: [
    { comment: 'c-1', text: 'Wrapped the price', line: 'cart.ts:12' },
    { comment: 'c-2', text: 'Raised the limit', line: 'cart.ts:40' },
  ],
  finish: [{ key: 'send_back', label: 'Send back', enabled: true }],
  featureUrl: 'https://track.example.test/feature/1',
  expiresAt: '2026-11-30T00:00:00Z',
  cursor: 'cursor-1',
};
const SUMMARY = { v: 1, summary: [{ label: 'Sent back', value: '2 comments' }] };

let calls: Call[];
let answers: Record<string, Answer[]>;
let added: HTMLScriptElement[];
let stops: (() => void)[];
let flushes: boolean[];

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function fakeRelay(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { body?: string }) => {
      const op = /\/review\/(\w+)$/.exec(String(input))?.[1] ?? 'other';
      calls.push({ op, body: JSON.parse(init?.body ?? '{}') });
      const queued = answers[op]?.shift();
      const { status, body } = await (queued ??
        (op === 'read'
          ? { status: 200, body: SESSION }
          : op === 'finish'
            ? { status: 200, body: SUMMARY }
            : { status: 200, body: {} }));
      return new Response(JSON.stringify(body ?? {}), { status });
    }),
  );
}

const opsCalled = (op: string): Call[] => calls.filter((call) => call.op === op);

// The overlay answers the send-all event the way the collector does: taken, then flushed as told.
function overlay(host: HTMLElement, result: () => boolean | Promise<boolean>): void {
  host.addEventListener('passback:send-all', (event) => {
    const detail = (event as CustomEvent<{ flush(ok: boolean): void; taken: boolean }>).detail;
    detail.taken = true;
    flushes.push(true);
    calls.push({ op: 'flush', body: {} });
    void Promise.resolve(result()).then((ok) => detail.flush(ok));
  });
}

async function activated() {
  window.location.hash = `#pb-review${ID}`;
  const tag = document.createElement('script');
  tag.setAttribute('data-passback-endpoint', '/v1/ingest/demo');
  tag.setAttribute('data-passback-chunk', '/assets/collector.js');
  document.head.append(tag);
  fakeRelay();
  const append = document.head.appendChild.bind(document.head);
  vi.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
    if ((node as unknown as HTMLScriptElement).async) {
      added.push(node as unknown as HTMLScriptElement);
      return node;
    }
    return append(node);
  });
  const { startReview } = await import('./review-start');
  const host = document.body.appendChild(document.createElement('div'));
  const root = host.attachShadow({ mode: 'open' });
  const stop = startReview({
    doc: document,
    win: window,
    host,
    root,
    load: async () => undefined,
    unmount: () => undefined,
  });
  stops.push(stop);
  await import('./review-panel');
  added[0]?.dispatchEvent(new Event('load'));
  await settle();
  return { host, root, stop };
}

const verdict = (root: ShadowRoot, value: string) =>
  root.querySelector<HTMLButtonElement>(`[data-pb-verdict="${value}"]`)!;
function toSend(root: ShadowRoot): HTMLButtonElement {
  let next = root.querySelector<HTMLButtonElement>('.pb-review-next');
  while (next) {
    next.click();
    next = root.querySelector<HTMLButtonElement>('.pb-review-next');
  }
  return root.querySelector<HTMLButtonElement>('.pb-review-send')!;
}
function choose(root: ShadowRoot, values: string[]): void {
  values.forEach((value, i) => {
    if (i > 0) root.querySelector<HTMLButtonElement>('.pb-review-next')!.click();
    verdict(root, value).click();
  });
}
const notice = (root: ShadowRoot) => root.querySelector('.pb-review-notice')?.textContent;

beforeEach(() => {
  vi.resetModules();
  calls = [];
  answers = {};
  added = [];
  stops = [];
  flushes = [];
});

afterEach(() => {
  stops.forEach((stop) => stop());
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  window.location.hash = '';
  window.sessionStorage.clear();
  delete scope.__passback;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('activated review verdicts', () => {
  it('flushes and delivers selected verdicts from an activated review panel', async () => {
    const { root, host } = await activated();
    overlay(host, () => true);
    choose(root, ['fixed', 'still_wrong']);
    // Changing a choice leaves one verdict per comment.
    verdict(root, 'fixed').click();
    verdict(root, 'still_wrong').click();
    toSend(root).click();
    await settle();

    expect(opsCalled('finish')).toHaveLength(1);
    expect(opsCalled('finish')[0]!.body).toMatchObject({
      v: 1,
      review: ID,
      finish: 'send_back',
      checks: [
        { comment: 'c-1', verdict: 'fixed' },
        { comment: 'c-2', verdict: 'still_wrong' },
      ],
    });
    // The flush came first, and no verdict was written on its own.
    const order = calls.map((call) => call.op).filter((op) => op !== 'read');
    expect(order).toEqual(['flush', 'finish']);
    expect(root.querySelector('.pb-review-summary')?.textContent).toContain('2 comments');
  });

  it('keeps all fixed reviews on the supplied feature link without posting pass', async () => {
    const { root, host } = await activated();
    overlay(host, () => true);
    choose(root, ['fixed', 'fixed']);
    toSend(root).click();
    await settle();

    expect(opsCalled('finish')[0]!.body.checks).toEqual([
      { comment: 'c-1', verdict: 'fixed' },
      { comment: 'c-2', verdict: 'fixed' },
    ]);
    expect(calls.map((call) => call.op).filter((op) => !['read', 'flush'].includes(op))).toEqual([
      'finish',
    ]);
    const link = root.querySelector('a');
    expect(link?.getAttribute('href')).toBe(SESSION.featureUrl);
    expect(
      [...root.querySelectorAll('button')].some((b) => /pass/i.test(b.textContent ?? '')),
    ).toBe(false);
  });

  it('retains verdicts after finish refusal and reuses the finish identity on retry', async () => {
    const { root, host } = await activated();
    overlay(host, () => true);
    answers.finish = [{ status: 500 }];
    choose(root, ['fixed', 'still_wrong']);
    toSend(root).click();
    await settle();
    expect(notice(root)).toBe('Could not complete review action.');
    expect(root.querySelector('.pb-review-send')).not.toBeNull();

    // The choices are still on their pages for the explicit retry.
    root.querySelector<HTMLButtonElement>('[aria-label="Previous"]')!.click();
    expect(verdict(root, 'still_wrong').getAttribute('aria-pressed')).toBe('true');
    toSend(root).click();
    await settle();

    const [first, second] = opsCalled('finish');
    expect(opsCalled('finish')).toHaveLength(2);
    expect(second!.body.finish_id).toBe(first!.body.finish_id);
    expect(second!.body.checks).toEqual(first!.body.checks);
    expect(second!.body.checks).toHaveLength(2);
    expect(root.querySelector('.pb-review-summary')).not.toBeNull();
  });

  it('blocks verdict finish on failed flush and ignores completion after teardown', async () => {
    const { root, host, stop } = await activated();
    let release!: (ok: boolean) => void;
    let held = false;
    overlay(host, () => {
      if (held) return new Promise<boolean>((resolve) => (release = resolve));
      return false;
    });
    choose(root, ['fixed', 'still_wrong']);
    toSend(root).click();
    await settle();
    expect(opsCalled('finish')).toHaveLength(0);
    expect(notice(root)).toBe('Could not complete review action.');

    // A second press while the flush is pending posts nothing; the stop then drops the late flush.
    held = true;
    toSend(root).click();
    await settle();
    expect(toSend(root).disabled).toBe(true);
    stop();
    release(true);
    await settle();
    expect(opsCalled('finish')).toHaveLength(0);
    expect(root.childNodes).toHaveLength(0);
  });
});
