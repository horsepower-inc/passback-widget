// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keptReducer } from './kept';
import { HOST_ATTRIBUTE } from './mount';
import type { Widget } from './index';
import type { SendAllCtx } from './send-all';
import { CLASS } from './styles';
import { armWidget } from './test-arm';
import { TRAY_CLASS } from './tray-view';

// The real widget, sendAll add-on, collector and session client; only the relay is faked.
const ID = 'abcdefghijklmnopqrstuv2345';
const CHUNK = 'passback-review-panel.js';
const scope = window as unknown as { __passback?: Record<string, unknown> };
type Answer = { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>;
type Mark = { intent: { comment: string } };
type Call = { url: string; body: { batch?: { id: string; review?: string; marks: Mark[] } } };

const SESSION = {
  v: 1,
  state: 'open',
  title: 'Cart review',
  version: 'rc3',
  round: 2,
  check: 'Does it fit?',
  labels: [{ key: 'k-bug', label: 'Bug' }],
  comments: [],
  finish: [{ key: 'send_back', label: 'Send back', enabled: true }],
  featureUrl: 'https://track.example.test/feature/1',
  expiresAt: '2026-11-30T00:00:00Z',
  cursor: 'cursor-1',
};
const CLOSED = [
  [409, 'review_finished', 'This round has closed.'],
  [410, 'review_expired', 'This review link has expired. Take the new link from your team.'],
] as const;
const ack = (...accepted: string[]) => ({
  status: 202,
  body: { v: 1, ok: true, batchId: 'b', accepted, trimmed: [] },
});

let calls: Call[];
let batchAnswers: Answer[];
let added: HTMLScriptElement[];
let widgets: Widget[];

const batches = () => calls.flatMap(({ body }) => (body.batch ? [body.batch] : []));
const finishes = () => calls.filter(({ url }) => url.endsWith('/review/finish'));

function fakeRelay() {
  const fetchFn = vi.fn(async (input: unknown, init?: { body?: string }) => {
    const url = String(input);
    const body = JSON.parse(init?.body ?? '{}') as Call['body'];
    calls.push({ url, body });
    let answer: Answer = { status: 200, body: {} };
    if (url.endsWith('/review/read')) answer = { status: 200, body: SESSION };
    if (url.endsWith('/review/finish')) answer = { status: 200, body: { v: 1, summary: [] } };
    if (body.batch) {
      const count = body.batch.marks.length;
      answer = batchAnswers.shift() ?? ack(...Array.from({ length: count }, (_, i) => `c-${i}`));
    }
    const { status, body: json } = await answer;
    return new Response(JSON.stringify(json ?? {}), { status });
  });
  vi.stubGlobal('fetch', fetchFn);
  return fetchFn;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function startWidget(): Promise<ShadowRoot> {
  const tag = document.createElement('script');
  tag.setAttribute('data-passback-endpoint', '/v1/ingest/demo');
  tag.setAttribute('data-passback-chunk', '/assets/collector.js');
  document.head.append(tag);
  await import('./collect');
  await import('./review-panel');
  scope.__passback = { ...scope.__passback, autoStart: false };
  const { start } = await import('./index');
  widgets.push(start(document, window));
  const root = document.querySelector<HTMLElement>(`[${HOST_ATTRIBUTE}]`)!.shadowRoot!;
  await settle();
  armWidget(root);
  await settle();
  return root;
}

function compose(
  root: ShadowRoot,
  text: string,
  target: Element = document.body.appendChild(document.createElement('div')),
): void {
  target.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }),
  );
  const input = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
  input.value = text;
  input.dispatchEvent(new Event('input'));
}

function keep(root: ShadowRoot, text: string, target?: Element): void {
  compose(root, text, target);
  root.querySelector<HTMLElement>('[data-role="add-more"]')!.click();
}

const backButton = (root: ShadowRoot) => root.querySelector<HTMLButtonElement>('.pb-review-send')!;
// The panel's Send back is a `.pb-send` too: the bubble's own Send is the one with the send role.
const bubbleSend = (root: ShadowRoot) => root.querySelector<HTMLElement>('[data-role="send"]')!;
const notice = (root: ShadowRoot) => root.querySelector('.pb-review-notice')?.textContent;
const dot = (root: ShadowRoot) => root.querySelector(`.${CLASS.dot}`)?.getAttribute('data-state');

beforeEach(() => {
  vi.resetModules();
  calls = [];
  batchAnswers = [];
  added = [];
  widgets = [];
  const append = document.head.appendChild.bind(document.head);
  vi.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
    if (!(node as unknown as HTMLScriptElement).async) return append(node);
    added.push(node as unknown as HTMLScriptElement);
    return node;
  });
});

afterEach(() => {
  widgets.forEach((widget) => widget.stop());
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  window.location.hash = '';
  window.sessionStorage.clear();
  delete scope.__passback;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('review comments through the real widget', () => {
  it('adds nothing to real startup without a review link', async () => {
    const fetchFn = fakeRelay();
    const seen: string[] = [];
    let owner: object = document;
    while (!Object.hasOwn(owner, 'addEventListener'))
      owner = Object.getPrototypeOf(owner) as object;
    const typed = owner as EventTarget;
    const add = typed.addEventListener;
    vi.spyOn(typed, 'addEventListener').mockImplementation(function (
      this: EventTarget,
      ...args: Parameters<typeof add>
    ) {
      seen.push(args[0]);
      return add.apply(this, args);
    });
    const root = await startWidget();
    expect(added.filter((script) => script.src.endsWith(CHUNK))).toHaveLength(0);
    expect(seen).not.toContain('visibilitychange');
    expect(seen.filter((type) => type === 'passback:send-all')).toHaveLength(1);
    expect(root.querySelector('.pb-review')).toBeNull();
    expect(scope.__passback?.reviewRoute).toBeUndefined();
    expect(fetchFn.mock.calls.filter(([url]) => String(url).includes('/review/'))).toEqual([]);

    keep(root, 'an ordinary comment');
    root.querySelector<HTMLElement>(`.${TRAY_CLASS.tray} .${CLASS.send}`)!.click();
    await settle();
    expect(batches()).toHaveLength(1);
    expect(batches()[0]!.review).toBeUndefined();
  });

  it('sends ordinarily until a read has answered, then through the client', async () => {
    window.location.hash = `#pb-review${ID}`;
    fakeRelay();
    const root = await startWidget();
    // The chunk is registered here, so it activated at once and its first read has answered.
    expect(added.filter((script) => script.src.endsWith(CHUNK))).toHaveLength(0);
    expect(root.querySelector('.pb-review')).not.toBeNull();
    compose(root, 'after the read');
    bubbleSend(root).click();
    await settle();
    expect(batches().map(({ review }) => review)).toEqual([ID]);
  });

  it('retries a failed comment under its batch id when Send back flushes it', async () => {
    window.location.hash = `#pb-review${ID}`;
    batchAnswers = [{ status: 500 }];
    fakeRelay();
    const root = await startWidget();
    compose(root, 'pinned in the session');
    bubbleSend(root).click();
    await settle();
    expect(batches()).toHaveLength(1);
    expect(batches()[0]!.review).toBe(ID);
    expect(dot(root)).toBe('failed');

    backButton(root).click();
    await settle();
    expect(batches()).toHaveLength(2);
    expect(batches()[1]!.id).toBe(batches()[0]!.id);
    expect(batches()[1]!.review).toBe(ID);
    expect(finishes()).toHaveLength(1);
    expect(dot(root)).toBe('sent');
  });

  it('keeps comments on a failed flush and retries the same list under one batch id', async () => {
    window.location.hash = `#pb-review${ID}`;
    batchAnswers = [{ status: 500 }];
    fakeRelay();
    const root = await startWidget();
    keep(root, 'kept one');
    keep(root, 'kept two');

    backButton(root).click();
    await settle();
    expect(batches()).toHaveLength(1);
    expect(finishes()).toHaveLength(0);
    expect(notice(root)).toBe('Could not complete review action.');
    expect(root.querySelectorAll('.pb-list li')).toHaveLength(2);

    backButton(root).click();
    await settle();
    expect(batches()).toHaveLength(2);
    expect(batches()[1]!.id).toBe(batches()[0]!.id);
    expect(batches()[1]!.marks.map((mark) => mark.intent.comment)).toEqual([
      'kept one',
      'kept two',
    ]);
    expect(root.querySelectorAll('.pb-list li')).toHaveLength(0);
    expect(finishes()).toHaveLength(1);
  });

  it('gives a changed list its own batch id', async () => {
    window.location.hash = `#pb-review${ID}`;
    batchAnswers = [{ status: 500 }];
    fakeRelay();
    const root = await startWidget();
    keep(root, 'kept one');
    keep(root, 'kept two');
    backButton(root).click();
    await settle();
    root.querySelector<HTMLElement>('.pb-list li button')!.click();
    await settle();
    backButton(root).click();
    await settle();
    expect(batches()).toHaveLength(2);
    expect(batches()[1]!.marks).toHaveLength(1);
    expect(batches()[1]!.id).not.toBe(batches()[0]!.id);
  });

  it('a new submission with the same words gets a new batch id', async () => {
    window.location.hash = `#pb-review${ID}`;
    batchAnswers = [{ status: 500 }];
    fakeRelay();
    const root = await startWidget();
    const target = document.body.appendChild(document.createElement('div'));
    keep(root, 'same words', target);
    root.querySelector<HTMLElement>(`.${TRAY_CLASS.tray} .${CLASS.send}`)!.click();
    await settle();
    expect(batches()).toHaveLength(1);
    root.querySelector<HTMLElement>('.pb-list li button')!.click();
    await settle();

    armWidget(root);
    await settle();
    keep(root, 'same words', target);
    root.querySelector<HTMLElement>(`.${TRAY_CLASS.tray} .${CLASS.send}`)!.click();
    await settle();
    expect(batches()).toHaveLength(2);
    expect(batches()[1]!.marks[0]!.intent.comment).toBe('same words');
    expect(batches()[1]!.id).not.toBe(batches()[0]!.id);
  });

  it('keeps the batch id of a failed list when another destination was sent in between', async () => {
    window.location.hash = `#pb-review${ID}`;
    batchAnswers = [{ status: 500 }];
    fakeRelay();
    await import('./collect');
    let ctx!: SendAllCtx;
    const { addons } = scope.__passback!.fx as { addons: unknown[] };
    addons.push((given: SendAllCtx) => void (ctx = given));
    const root = await startWidget();
    keep(root, 'for the agent');
    keep(root, 'for the tracker');
    ctx.state.kept = keptReducer(ctx.state.kept, { type: 'dest', n: 2, dest: 'tracker' });
    const sendTo = (dest: string) =>
      ctx.host.dispatchEvent(new CustomEvent('passback:send-all', { detail: { dest } }));
    sendTo('agent');
    await settle();
    sendTo('tracker');
    await settle();
    sendTo('agent');
    await settle();
    const [failed, tracker, retried] = batches();
    expect(retried!.id).toBe(failed!.id);
    expect(tracker!.id).not.toBe(failed!.id);
  });

  it('a comment after the round closed keeps its text and says so', async () => {
    for (const [status, code, words] of CLOSED) {
      vi.resetModules();
      calls = [];
      window.location.hash = `#pb-review${ID}`;
      batchAnswers = [{ status, body: { code } }];
      fakeRelay();
      const root = await startWidget();
      compose(root, `kept after ${code}`);
      bubbleSend(root).click();
      await settle();
      expect(batches()).toHaveLength(1);
      expect(root.textContent).toContain(`Not sent: ${words} “kept after ${code}”`);
      expect(root.textContent!.split('kept.')).toHaveLength(2);
      expect(dot(root)).toBe('failed');

      // Retry: the same words, no request, nothing filed elsewhere; the controls stay, disabled.
      const before = calls.length;
      [...root.querySelectorAll('button')].find((b) => b.textContent === 'Retry')!.click();
      await settle();
      expect(calls).toHaveLength(before);
      expect(root.textContent).toContain(`Not sent: ${words} “kept after ${code}”`);
      expect(scope.__passback?.reviewRoute).toBeTypeOf('function');
      expect(backButton(root).disabled).toBe(true);
      widgets.pop()!.stop();
    }
  });

  it('a kept comment after a successful Send back is refused with the same words', async () => {
    window.location.hash = `#pb-review${ID}`;
    fakeRelay();
    const root = await startWidget();
    backButton(root).click();
    await settle();
    expect(backButton(root).disabled).toBe(true);
    keep(root, 'too late');
    const before = calls.length;
    root.querySelector<HTMLElement>(`.${TRAY_CLASS.tray} .${CLASS.send}`)!.click();
    await settle();
    expect(calls).toHaveLength(before);
    expect(root.textContent).toContain(CLOSED[0][2]);
    expect(root.querySelector('.pb-list li')?.textContent).toContain('too late');
  });

  it('flushes both destinations through the client, also from a closed panel', async () => {
    window.location.hash = `#pb-review${ID}`;
    fakeRelay();
    await import('./collect');
    let ctx!: SendAllCtx & { panel: { dismiss(): void } };
    const { addons } = scope.__passback!.fx as { addons: unknown[] };
    addons.push((given: typeof ctx) => void (ctx = given));
    const root = await startWidget();
    keep(root, 'for the agent');
    keep(root, 'for the tracker');
    ctx.state.kept = keptReducer(ctx.state.kept, { type: 'dest', n: 2, dest: 'tracker' });
    ctx.panel.dismiss();
    expect(ctx.host.getAttribute('data-pb-panel')).toBe('closed');

    backButton(root).click();
    await settle();
    expect(batches().map(({ review }) => review)).toEqual([ID, ID]);
    expect(batches().map(({ marks }) => marks[0]!.intent.comment)).toEqual([
      'for the agent',
      'for the tracker',
    ]);
    expect(ctx.state.kept.items).toHaveLength(0);
    expect(finishes()).toHaveLength(1);
  });

  it('holds the finish while a draft is unsent or a send is in flight', async () => {
    window.location.hash = `#pb-review${ID}`;
    let answer!: (value: { status: number; body?: unknown }) => void;
    batchAnswers = [new Promise((resolve) => (answer = resolve))];
    fakeRelay();
    const root = await startWidget();
    compose(root, 'still typing');
    backButton(root).click();
    await settle();
    expect(finishes()).toHaveLength(0);
    expect(notice(root)).toBe('Send or clear your draft before sending back.');
    expect(root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!.value).toBe('still typing');

    bubbleSend(root).click();
    await settle();
    expect(batches()).toHaveLength(1);
    backButton(root).click();
    await settle();
    expect(finishes()).toHaveLength(0);
    answer(ack('c-9'));
    await settle();
    expect(batches()).toHaveLength(1);
    expect(finishes()).toHaveLength(1);
  });

  it('answers false when the widget stops under a waiting flush', async () => {
    window.location.hash = `#pb-review${ID}`;
    batchAnswers = [new Promise(() => undefined)];
    fakeRelay();
    const root = await startWidget();
    keep(root, 'kept');
    backButton(root).click();
    await settle();
    widgets[0]!.stop();
    await settle();
    expect(finishes()).toHaveLength(0);
  });

  it('removes review with the widget and starts one session per widget', async () => {
    window.location.hash = `#pb-review${ID}`;
    fakeRelay();
    const root = await startWidget();
    expect(root.querySelector('.pb-review')).not.toBeNull();
    const { start } = await import('./index');
    start(document, window);
    expect(calls.filter(({ url }) => url.endsWith('/review/read'))).toHaveLength(1);
    widgets[0]!.stop();
    expect(scope.__passback?.reviewRoute).toBeUndefined();
    expect(root.querySelector('.pb-review')).toBeNull();
  });
});

describe('chunk loads the review start shares', () => {
  const setup = (attrs: Record<string, string>) => {
    const doc = document.implementation.createHTMLDocument('');
    const tag = doc.createElement('script');
    for (const [name, value] of Object.entries(attrs)) tag.setAttribute(name, value);
    doc.head.append(tag);
    vi.spyOn(doc.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => node);
    return { doc, tag, win: {} as Window };
  };

  it('answers a second shot call with the load in flight even when the enabling script is gone', async () => {
    const { loadShotOpen } = await import('./shot-loader');
    const { doc, tag, win } = setup({
      'data-passback-screenshots': 'true',
      'data-passback-shot': '/shot.js',
      'data-passback-endpoint': '/e',
    });
    const first = loadShotOpen(doc, win);
    tag.remove();
    expect(loadShotOpen(doc, win)).toBe(first);
  });

  it('answers a second collector call with the load in flight even when the script is gone', async () => {
    const { loadCollectFactory } = await import('./collector-loader');
    const { doc, tag, win } = setup({ 'data-passback-chunk': '/c.js' });
    const first = loadCollectFactory(doc, win);
    tag.remove();
    expect(loadCollectFactory(doc, win)).toBe(first);
  });

  it('still refuses when nothing is in flight and nothing is configured', async () => {
    const { loadShotOpen } = await import('./shot-loader');
    const { loadCollectFactory } = await import('./collector-loader');
    const { doc, win } = setup({});
    await expect(loadShotOpen(doc, win)).rejects.toThrow('screenshots are not enabled');
    await expect(loadCollectFactory(doc, win)).rejects.toThrow('no data-passback-chunk');
  });
});

describe('the label buttons of an unlabelled comment', () => {
  it('press no label and send nothing until one is chosen', async () => {
    const { openReviewPanel } = await import('./review-panel');
    const host = document.body.appendChild(document.createElement('div'));
    const root = host.attachShadow({ mode: 'open' });
    const comment = { mark: 'm', text: 't', status: 'open', tone: 'plain', overruled: false };
    const overrule = vi.fn();
    openReviewPanel({
      root,
      session: {
        ...SESSION,
        labels: [{ key: 'k-bug', label: 'Bug' }],
        comments: [
          { ...comment, id: 'a', label: null },
          { ...comment, id: 'b', label: 'k-gone' },
          { ...comment, id: 'c', label: 'k-bug' },
        ],
      } as Parameters<typeof openReviewPanel>[0]['session'],
      actions: { overrule, finish: vi.fn() },
    });
    const bug = () => root.querySelector<HTMLButtonElement>('[data-pb-label="k-bug"]')!;
    const next = () => root.querySelector<HTMLButtonElement>('.pb-review-next')!;
    const pressed = () => [...root.querySelectorAll('[aria-pressed="true"]')].length;
    expect(root.querySelectorAll('[data-pb-label]')).toHaveLength(1);
    expect(bug().getAttribute('aria-pressed')).toBe('false');
    next().click();
    expect(pressed()).toBe(0);
    next().click();
    expect(bug().getAttribute('aria-pressed')).toBe('true');
    bug().click();
    expect(overrule).not.toHaveBeenCalled();
    root.querySelector<HTMLButtonElement>('.pb-review-pager button')!.click();
    root.querySelector<HTMLButtonElement>('.pb-review-pager button')!.click();
    bug().click();
    expect(overrule).toHaveBeenCalledWith('a', 'k-bug');
  });
});
