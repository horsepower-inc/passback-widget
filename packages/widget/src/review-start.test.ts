// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REVIEW_STORAGE_KEY } from './review-link';

const ID = 'abcdefghijklmnopqrstuv2345';
const CHUNK = 'passback-review-panel.js';
const scope = window as unknown as { __passback?: Record<string, unknown> };
type Answer = { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>;
type Call = { url: string; body: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any

const SESSION = {
  v: 1,
  state: 'open',
  title: 'Cart review',
  version: 'rc3',
  round: 2,
  check: 'Does it fit?',
  labels: [
    { key: 'k-bug', label: 'Bug' },
    { key: 'k-later', label: 'Later' },
  ],
  comments: [
    {
      id: 'c-1',
      mark: 'm-1',
      text: 'The price is cut',
      label: 'k-bug',
      status: 'open',
      tone: 'plain',
      overruled: false,
    },
  ],
  finish: [{ key: 'send_back', label: 'Send back', enabled: true }],
  featureUrl: 'https://track.example.test/feature/1',
  expiresAt: '2026-11-30T00:00:00Z',
  cursor: 'cursor-1',
};
const SUMMARY = { v: 1, summary: [{ label: 'Sent back', value: '1 comment' }] };

let calls: Call[];
let answers: Record<string, Answer[]>;
let added: HTMLScriptElement[];
let stops: (() => void)[];

function answerFor(op: string): Answer {
  const queued = answers[op]?.shift();
  if (queued) return queued;
  if (op === 'read') return { status: 200, body: { ...SESSION, comments: [] } };
  if (op === 'overrule')
    return { status: 200, body: { v: 1, comment: 'c-1', status: 'overruled' } };
  if (op === 'finish') return { status: 200, body: SUMMARY };
  if (op === 'other') return { status: 200, body: {} };
  return { status: 202, body: { v: 1, ok: true, batchId: 'b', accepted: ['c-9'], trimmed: [] } };
}

function fakeRelay() {
  const fetchFn = vi.fn(async (input: unknown, init?: { body?: string }) => {
    const url = String(input);
    const body = JSON.parse(init?.body ?? '{}') as Call['body'];
    calls.push({ url, body });
    const op = /\/review\/(\w+)$/.exec(url)?.[1] ?? (body.batch ? 'batch' : 'other');
    const { status, body: answer } = await answerFor(op);
    return new Response(JSON.stringify(answer ?? {}), { status });
  });
  vi.stubGlobal('fetch', fetchFn);
  return fetchFn;
}

const opsCalled = (op: string): Call[] => calls.filter(({ url }) => url.endsWith(`/review/${op}`));

function configure(attrs: Record<string, string> = {}): void {
  const tag = document.createElement('script');
  const all: Record<string, string> = {
    'data-passback-endpoint': '/v1/ingest/demo',
    'data-passback-chunk': '/assets/collector.js',
    ...attrs,
  };
  for (const [name, value] of Object.entries(all)) if (value) tag.setAttribute(name, value);
  document.head.append(tag);
}

function capture(): void {
  const append = document.head.appendChild.bind(document.head);
  vi.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
    if ((node as unknown as HTMLScriptElement).async) {
      added.push(node as unknown as HTMLScriptElement);
      return node;
    }
    return append(node);
  });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function mounted() {
  const host = document.body.appendChild(document.createElement('div'));
  return { host, root: host.attachShadow({ mode: 'open' }) };
}

async function begin(load: () => Promise<unknown> = async () => undefined) {
  const { startReview } = await import('./review-start');
  const { host, root } = mounted();
  const stop = startReview({
    doc: document,
    win: window,
    host,
    root,
    load,
    unmount: () => undefined,
  });
  stops.push(stop);
  return { host, root, stop };
}

// The real chunk: importing it registers the way a loaded script does.
async function activated(load?: () => Promise<unknown>) {
  window.location.hash = `#pb-review${ID}`;
  configure();
  fakeRelay();
  const opened = await begin(load);
  await import('./review-panel');
  added[0]?.dispatchEvent(new Event('load'));
  await settle();
  return opened;
}

// Send back lives on the panel's last page: this pages there first.
function send(root: ShadowRoot): HTMLButtonElement {
  let next = root.querySelector<HTMLButtonElement>('.pb-review-next');
  while (next) {
    next.click();
    next = root.querySelector<HTMLButtonElement>('.pb-review-next');
  }
  return root.querySelector<HTMLButtonElement>('.pb-review-send')!;
}
const notice = (root: ShadowRoot) => root.querySelector('.pb-review-notice')?.textContent;
const labelButton = (root: ShadowRoot, key: string) =>
  root.querySelector<HTMLButtonElement>(`[data-pb-label="${key}"]`)!;
const chosen = (root: ShadowRoot) =>
  root.querySelector<HTMLElement>('[data-pb-label][aria-pressed="true"]')?.dataset.pbLabel;
const who = (root: ShadowRoot) => root.querySelector('.pb-review-meaning')?.textContent;
const pick = (root: ShadowRoot, key: string): void => labelButton(root, key).click();

beforeEach(() => {
  vi.resetModules();
  calls = [];
  answers = {};
  added = [];
  stops = [];
  capture();
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

describe('review start', () => {
  it('leaves a page without a review link unchanged', async () => {
    configure();
    const fetchFn = fakeRelay();
    const timer = vi.spyOn(globalThis, 'setTimeout');
    const onDoc = vi.spyOn(document, 'addEventListener');
    const onWin = vi.spyOn(window, 'addEventListener');
    const { root, stop, host } = await begin();
    const onHost = vi.spyOn(host, 'addEventListener');
    stop();
    expect(added).toHaveLength(0);
    expect(root.childNodes).toHaveLength(0);
    for (const spy of [fetchFn, timer, onDoc, onWin, onHost]) expect(spy).not.toHaveBeenCalled();
    expect(scope.__passback?.reviewRoute).toBeUndefined();
  });

  it('loads review capabilities beside the collector only once', async () => {
    window.location.hash = `#pb-review${ID}`;
    configure({ 'data-passback-chunk': 'https://cdn.test/v1/collector.js' });
    fakeRelay();
    await begin();
    expect(added.map((script) => script.src)).toEqual([`https://cdn.test/v1/${CHUNK}`]);
    expect(added[0]!.async).toBe(true);

    vi.resetModules();
    document.head.innerHTML = '';
    added.length = 0;
    configure({ 'data-passback-chunk': '../assets/collector.js' });
    await begin();
    expect(added[0]!.src).toBe(new URL(`../assets/${CHUNK}`, document.baseURI).href);

    vi.resetModules();
    document.head.innerHTML = '';
    added.length = 0;
    configure({ 'data-passback-chunk': '', src: 'https://cdn.test/w/passback.js' });
    const { start } = await import('./index');
    scope.__passback = { autoStart: false };
    const widget = start(document, window);
    stops.push(() => widget.stop());
    expect(start(document, window)).toBe(widget);
    const review = added.filter((script) => script.src.endsWith(CHUNK));
    expect(review.map((script) => script.src)).toEqual([`https://cdn.test/w/${CHUNK}`]);
    review[0]!.dispatchEvent(new Event('error'));
    await settle();
    expect(added.filter((script) => script.src.endsWith(CHUNK))).toHaveLength(1);
  });

  it('keeps the namespace of the page and registers without starting', async () => {
    const shot = (): undefined => undefined;
    const fetchFn = fakeRelay();
    scope.__passback = { shot };
    await import('./review-panel');
    expect(scope.__passback.shot).toBe(shot);
    expect(typeof scope.__passback.reviewActivate).toBe('function');
    expect(fetchFn).not.toHaveBeenCalled();
    expect(added).toHaveLength(0);
  });

  it('fails soft on review loading and initial read failures', async () => {
    const rejected = vi.fn();
    window.addEventListener('unhandledrejection', rejected);
    window.location.hash = `#pb-review${ID}`;

    // no endpoint: nothing starts
    configure({ 'data-passback-endpoint': '' });
    fakeRelay();
    await begin();
    expect(added).toHaveLength(0);
    document.head.innerHTML = '';

    // a missing asset
    configure();
    const failed = await begin();
    added[0]!.dispatchEvent(new Event('error'));
    await settle();
    expect(failed.root.childNodes).toHaveLength(0);

    // a chunk that registered nothing
    added.length = 0;
    const blank = await begin();
    added[0]!.dispatchEvent(new Event('load'));
    await settle();
    expect(blank.root.childNodes).toHaveLength(0);

    // a registration that throws
    added.length = 0;
    const broken = await begin();
    scope.__passback = {
      reviewActivate: () => {
        throw new Error('no client');
      },
    };
    expect(() => added[0]!.dispatchEvent(new Event('load'))).not.toThrow();
    await settle();
    expect(() => broken.stop()).not.toThrow();
    delete scope.__passback;
    await settle();
    expect(rejected).not.toHaveBeenCalled();
    window.removeEventListener('unhandledrejection', rejected);
  });

  it('shows no panel and keeps sending ordinarily when the first read fails', async () => {
    window.location.hash = `#pb-review${ID}`;
    configure();
    answers.read = [{ status: 500 }];
    fakeRelay();
    const { root } = await begin();
    await import('./review-panel');
    added[0]!.dispatchEvent(new Event('load'));
    await settle();
    expect(opsCalled('read')).toHaveLength(1);
    expect(root.querySelector('.pb-review')).toBeNull();
    expect(scope.__passback?.reviewRoute).toBeUndefined();
  });

  it('treats an old relay without review routes as no review', async () => {
    window.location.hash = `#pb-review${ID}`;
    configure();
    answers.read = [{ status: 404 }];
    fakeRelay();
    const { root } = await begin();
    await import('./review-panel');
    added[0]!.dispatchEvent(new Event('load'));
    await settle();
    expect(root.querySelector('.pb-review')).toBeNull();
    expect(window.sessionStorage.getItem(REVIEW_STORAGE_KEY)).toBeNull();
    expect(scope.__passback?.reviewRoute).toBeUndefined();
  });

  it('wires overrules flush and send back through the session client', async () => {
    answers.read = [{ status: 200, body: SESSION }];
    const load = vi.fn(async () => undefined);
    const { root, host } = await activated(load);
    expect(opsCalled('read')[0]!.body).toEqual({ v: 1, review: ID });
    expect(root.querySelector('.pb-review-title')?.textContent).toBe('Cart review');

    // Overrule: disabled while pending, applied only on success.
    let answer!: (value: { status: number; body?: unknown }) => void;
    answers.overrule = [new Promise((resolve) => (answer = resolve))];
    pick(root, 'k-later');
    expect(labelButton(root, 'k-later').disabled).toBe(true);
    await settle();
    expect(opsCalled('overrule')[0]!.body).toEqual({
      v: 1,
      review: ID,
      comment: 'c-1',
      label: 'k-later',
    });
    answer({ status: 500 });
    await settle();
    expect(labelButton(root, 'k-later').disabled).toBe(false);
    expect(chosen(root)).toBe('k-bug');
    expect(notice(root)).toBe('Could not complete review action.');
    expect(who(root)).toBe('The agent sorted it here. Change it if that is wrong.');

    pick(root, 'k-later');
    await settle();
    expect(chosen(root)).toBe('k-later');
    expect(who(root)).toBe('You moved it here.');
    expect(notice(root)).toBeFalsy();

    // Finish waits for the flush the overlay answers, and a failed flush posts nothing.
    const flushes: ((ok: boolean) => void)[] = [];
    host.addEventListener('passback:send-all', (event) => {
      const detail = (event as CustomEvent<{ flush(ok: boolean): void; taken: boolean }>).detail;
      detail.taken = true;
      flushes.push(detail.flush);
    });
    send(root).click();
    await settle();
    expect(load).toHaveBeenCalledOnce();
    expect(send(root).disabled).toBe(true);
    expect(opsCalled('finish')).toHaveLength(0);
    flushes[0]!(false);
    await settle();
    expect(opsCalled('finish')).toHaveLength(0);
    expect(notice(root)).toBe('Could not complete review action.');
    expect(send(root).disabled).toBe(false);

    // Held: the comments show, the session stays, the retry keeps the finish id.
    answers.finish = [{ status: 409, body: { code: 'review_held', comments: ['c-1', 'c-404'] } }];
    send(root).click();
    await settle();
    flushes[1]!(true);
    await settle();
    expect(notice(root)).toBe('Resolve these comments before sending back.');
    expect([...root.querySelectorAll('.pb-review-held li')].map((li) => li.textContent)).toEqual([
      'The price is cut',
      'c-404',
    ]);
    expect(send(root).disabled).toBe(false);

    send(root).click();
    await settle();
    flushes[2]!(true);
    await settle();
    const [first, second] = opsCalled('finish');
    expect(second!.body.finish_id).toBe(first!.body.finish_id);
    expect(second!.body.finish).toBe('send_back');
    expect(root.querySelector('.pb-review-summary')?.textContent).toContain('1 comment');
    expect(send(root).disabled).toBe(true);
    expect(root.querySelector('[data-pb-label]')).toBeNull();
    expect(root.querySelector('a')?.getAttribute('href')).toBe(SESSION.featureUrl);
  });

  it('refuses a flush nobody answers, and a flush whose collector cannot load', async () => {
    answers.read = [{ status: 200, body: SESSION }];
    const load = vi.fn<() => Promise<unknown>>(async () => undefined);
    const { root } = await activated(load);
    send(root).click();
    await settle();
    expect(opsCalled('finish')).toHaveLength(0);
    expect(notice(root)).toBe('Could not complete review action.');

    load.mockRejectedValueOnce(new Error('no chunk'));
    send(root).click();
    await settle();
    expect(opsCalled('finish')).toHaveLength(0);
    expect(notice(root)).toBe('Could not complete review action.');
  });

  it('ends on the relay answer: finished and expired keep the panel, not found removes it', async () => {
    answers.read = [{ status: 200, body: SESSION }];
    const finished = await activated();
    answers.overrule = [{ status: 409, body: { code: 'review_finished' } }];
    pick(finished.root, 'k-later');
    await settle();
    expect(notice(finished.root)).toBe('Review finished.');
    expect(send(finished.root).disabled).toBe(true);
    expect(finished.root.querySelector('[data-pb-label]')).toBeNull();
    expect(window.sessionStorage.getItem(REVIEW_STORAGE_KEY)).toBeNull();
    // A later comment is refused rather than filed as an ordinary one.
    expect(scope.__passback?.reviewRoute).toBeTypeOf('function');
    finished.stop();
    expect(scope.__passback?.reviewRoute).toBeUndefined();

    added.length = 0;
    calls.length = 0;
    answers.read = [{ status: 200, body: SESSION }];
    answers.overrule = [{ status: 410, body: { code: 'review_expired' } }];
    const expired = await activated();
    pick(expired.root, 'k-later');
    await settle();
    expect(notice(expired.root)).toBe('Review expired.');
    expired.stop();

    added.length = 0;
    answers.read = [{ status: 200, body: SESSION }];
    answers.overrule = [{ status: 404, body: { code: 'review_not_found' } }];
    const gone = await activated();
    expect(scope.__passback?.reviewRoute).toBeTypeOf('function');
    pick(gone.root, 'k-later');
    await settle();
    expect(gone.root.querySelector('.pb-review')).toBeNull();
    expect(scope.__passback?.reviewRoute).toBeUndefined();
  });

  it('polls by actual visibility and panel state', async () => {
    answers.read = [{ status: 200, body: SESSION }];
    const { root } = await activated();
    expect(root.querySelector('.pb-review')).not.toBeNull();
    const timer = vi.spyOn(globalThis, 'setTimeout');
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(timer.mock.calls.map(([, ms]) => ms)).toContain(60_000);
    hidden.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(timer.mock.calls.map(([, ms]) => ms)).toContain(15_000);
    expect(clear).toHaveBeenCalled();
  });

  it('disposes review activation and ignores late completion', async () => {
    // Stop during loading: the late script mounts nothing.
    window.location.hash = `#pb-review${ID}`;
    configure();
    fakeRelay();
    const early = await begin();
    await import('./review-panel');
    const script = added[0]!;
    early.stop();
    script.dispatchEvent(new Event('load'));
    await settle();
    expect(calls).toHaveLength(0);
    expect(early.root.childNodes).toHaveLength(0);

    // Stop during the first read: its late answer mounts nothing.
    added.length = 0;
    let answer!: (value: { status: number; body?: unknown }) => void;
    answers.read = [new Promise((resolve) => (answer = resolve))];
    // The chunk is already registered now, so no second script loads.
    const reading = await begin();
    expect(added).toHaveLength(0);
    await settle();
    reading.stop();
    answer({ status: 200, body: SESSION });
    await settle();
    expect(reading.root.childNodes).toHaveLength(0);

    // Stop during an overrule: everything owned leaves and the answer changes nothing.
    added.length = 0;
    answers.read = [{ status: 200, body: SESSION }];
    answers.overrule = [new Promise((resolve) => (answer = resolve))];
    const off = vi.spyOn(document, 'removeEventListener');
    const { root, stop } = await begin();
    await settle();
    pick(root, 'k-later');
    await settle();
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    stop();
    stop();
    expect(root.childNodes).toHaveLength(0);
    expect(off.mock.calls.map(([type]) => type)).toContain('visibilitychange');
    expect(clear).toHaveBeenCalled();
    expect(scope.__passback?.reviewRoute).toBeUndefined();
    answer({ status: 200, body: { v: 1, comment: 'c-1', status: 'overruled' } });
    await settle();
    expect(root.childNodes).toHaveLength(0);
  });

  it('copies the review chunk in both package build lists', () => {
    for (const pkg of ['next', 'vite-plugin']) {
      const file = resolve(__dirname, `../../${pkg}/scripts/build.mjs`);
      expect(readFileSync(file, 'utf8')).toMatch(/^ {2}'passback-review-panel\.js',$/m);
    }
  });
});
