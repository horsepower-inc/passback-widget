// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddResult, ReviewActions } from './review-card';
import {
  activateReview,
  openReviewPanel,
  type ReviewComment,
  type ReviewSession,
} from './review-panel';

// happy-dom proves structure and declared styles, not browser layout.
const MARKUP = '<img src=x onerror="boom()"><b>loud</b>';
const FAILED = 'Could not complete review action.';
const PASS_LINE = 'Nothing to fix? Pass it on the feature page.';

function setup() {
  const doc = document.implementation.createHTMLDocument('');
  const host = doc.createElement('div');
  doc.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  return { doc, host, root };
}

function sessionWith(overrides: Partial<ReviewSession> = {}): ReviewSession {
  return {
    v: 1,
    state: 'open',
    title: 'Revue du panier',
    version: '2026.11-rc3',
    round: 4,
    check: 'Ça marche sur mobile ?',
    labels: [
      { key: 'feature', label: 'Cette fonctionnalité' },
      { key: 'bug', label: 'Bogue séparé' },
      { key: 'idea', label: 'Idée' },
    ],
    finish: [{ key: 'send_back', label: 'Renvoyer', enabled: true }],
    fixes: [{ comment: 'c-9', text: 'corrigé', line: 'L12' }],
    featureUrl: 'https://example.test/feature',
    expiresAt: '2026-11-03T00:00:00Z',
    cursor: 'cursor-1',
    comments: [
      {
        id: 'c-9',
        mark: 'm-2',
        text: 'Le bouton déborde',
        label: 'bug',
        status: 'open',
        tone: 'plain',
        overruled: false,
      },
      {
        id: 'c-1',
        mark: 'm-7',
        text: 'Pourquoi ce prix ?',
        label: 'feature',
        status: 'answered',
        tone: 'ask',
        overruled: true,
        question: 'Vous confirmez ?',
      },
    ],
    ...overrides,
  };
}

const comment = (fields: Partial<ReviewComment>): ReviewComment => ({
  id: 'c-1',
  mark: 'm-1',
  text: 'texte',
  label: null,
  status: 'open',
  tone: 'plain',
  overruled: false,
  ...fields,
});
const text = (scope: ParentNode, selector: string) => scope.querySelector(selector)?.textContent;
const texts = (scope: ParentNode, selector: string) =>
  [...scope.querySelectorAll(selector)].map((node) => node.textContent);
const card = (root: ParentNode) => root.querySelector<HTMLElement>('.pb-review')!;
const label = (root: ParentNode, key: string) =>
  root.querySelector<HTMLButtonElement>(`[data-pb-label="${key}"]`)!;
const pressed = (root: ParentNode) =>
  texts(root, '[data-pb-label][aria-pressed="true"]').join('|') || undefined;
const where = (root: ParentNode) => text(root, '.pb-review-where');
const next = (root: ParentNode) => root.querySelector<HTMLButtonElement>('.pb-review-next')!;
const pagerButtons = (root: ParentNode) => [
  ...root.querySelectorAll<HTMLButtonElement>('.pb-review-pager button'),
];
const sendBack = (root: ParentNode) => root.querySelector<HTMLButtonElement>('.pb-review-send');
const meaning = (root: ParentNode) => text(root, '.pb-review-meaning');
const count = (root: ParentNode) => text(root, '.pb-bar > .pb-note');
const toEnd = (root: ParentNode) => {
  while (root.querySelector('.pb-review-next')) next(root).click();
};
const press = (target: Element, key: string) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

function actionsOf<E extends Partial<ReviewActions> = Record<never, never>>(extra: E = {} as E) {
  return {
    overrule: vi.fn<ReviewActions['overrule']>(async (id) => ({
      ok: true,
      comment: id,
      status: 's',
    })),
    finish: vi.fn<ReviewActions['finish']>(async () => ({ ok: true, summary: [] })),
    ...extra,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('review panel pages', () => {
  it('pages with the chevrons, Next and the arrow keys, but not from the text field', () => {
    const { root } = setup();
    const actions = actionsOf({ add: vi.fn<NonNullable<ReviewActions['add']>>() });
    openReviewPanel({ root, session: sessionWith(), actions });
    press(label(root, 'bug'), 'ArrowRight');
    expect(where(root)).toBe('2 / 2');
    press(root.querySelector('textarea')!, 'ArrowLeft');
    expect(where(root)).toBe('2 / 2');
    press(card(root), 'ArrowLeft');
    expect(where(root)).toBe('1 / 2');
    press(card(root), 'ArrowLeft');
    expect(where(root)).toBe('1 / 2');
    pagerButtons(root)[1]!.click();
    pagerButtons(root)[1]!.click();
    expect(where(root)).toBe('Done');
    expect(pagerButtons(root).map((b) => b.disabled)).toEqual([false, true]);
    expect(root.querySelector('.pb-review-next')).toBeNull();
    press(card(root), 'ArrowRight');
    expect(where(root)).toBe('Done');
    pagerButtons(root)[0]!.click();
    expect(where(root)).toBe('2 / 2');

    const empty = setup();
    openReviewPanel({ root: empty.root, session: sessionWith({ comments: [] }), actions });
    expect(where(empty.root)).toBe('Done');
    expect(pagerButtons(empty.root).map((b) => b.disabled)).toEqual([true, true]);
  });

  it('says what the chosen label does and who sorted the comment', () => {
    const { root } = setup();
    const comments = [
      comment({ id: 'a', label: 'feature' }),
      comment({ id: 'b', label: 'bug', overruled: true }),
      comment({ id: 'c', label: 'idea' }),
      comment({ id: 'd', label: 'k-gone' }),
      comment({ id: 'e', label: 'constructor', overruled: true }),
      comment({ id: 'f', label: null, overruled: true }),
    ];
    openReviewPanel({ root, session: sessionWith({ comments }), actions: actionsOf() });
    const lines: (string | null | undefined)[] = [];
    for (let i = 0; i < comments.length; i++) {
      lines.push(meaning(root));
      next(root).click();
    }
    const agent = 'The agent sorted it here. Change it if that is wrong.';
    expect(lines).toEqual([
      `The agent fixes it in this feature before it can pass. ${agent}`,
      'Filed as its own bug. It does not hold this feature. You moved it here.',
      `Saved as an idea for later. It does not hold this feature. ${agent}`,
      agent,
      'You moved it here.',
      'Not sorted yet: the agent could not tell. Pick one.',
    ]);
    expect(where(root)).toBe('Done');
    pagerButtons(root)[0]!.click();
    expect(text(root, '.pb-review-meaning .pb-review-unsorted')).toBe(lines[5]);
    expect(pressed(root)).toBeUndefined();
    expect(count(root)).toBe('5 of 6 sorted');
  });

  it('overrules with one click on a label and keeps the choice until the server moves it', async () => {
    const { root } = setup();
    const actions = actionsOf();
    const session = sessionWith();
    const panel = openReviewPanel({ root, session, actions })!;
    label(root, 'bug').click();
    expect(actions.overrule).not.toHaveBeenCalled();
    label(root, 'idea').click();
    expect(actions.overrule).toHaveBeenCalledWith('c-9', 'idea');
    expect(label(root, 'feature').disabled).toBe(true);
    await vi.waitFor(() => expect(label(root, 'feature').disabled).toBe(false));
    expect(pressed(root)).toBe('Idée');
    expect(meaning(root)).toBe(
      'Saved as an idea for later. It does not hold this feature. You moved it here.',
    );
    // The next read still carries the old label: the tester's choice stands until the server moves it.
    panel.update({ ...session, cursor: 'c-2', comments: [...session.comments] });
    expect(pressed(root)).toBe('Idée');
    panel.update({
      ...session,
      comments: [{ ...session.comments[0]!, label: 'feature', text: 'relu' }, session.comments[1]!],
    });
    expect(pressed(root)).toBe('Cette fonctionnalité');
  });

  it('sums the round up on the last page and sends back only once every comment is sorted', async () => {
    const { root } = setup();
    const actions = actionsOf();
    const comments = [
      comment({ id: 'a', text: 'un', label: 'feature' }),
      comment({ id: 'b', text: 'deux', label: 'feature' }),
      comment({ id: 'c', text: 'trois', label: 'idea' }),
      comment({ id: 'd', text: `quatre ${MARKUP}`, label: null }),
    ];
    const session = {
      ...sessionWith({
        comments,
        finish: [
          { key: 'pass', label: 'Passer', enabled: true },
          { key: 'send_back', label: 'Renvoyer', enabled: true, note: `note ${MARKUP}` },
        ] as ReviewSession['finish'],
      }),
      roundLabel: 'Tour 4 sur 9',
    };
    const region = openReviewPanel({ root, session, actions })!.element;
    expect(text(root, '.pb-review-round')).toBe('Tour 4 sur 9');
    toEnd(root);
    expect(where(root)).toBe('Done');
    expect(text(root, '.pb-review-strong')).toBe('Send back to fix');
    expect(text(root, '.pb-review-lead')).toBe(
      'The agent fixes the 2 comments sorted Cette fonctionnalité. ' +
        'Then you get a new round and check each fix: Fixed or Still wrong.',
    );
    expect(texts(root, '.pb-review-lead b')).toEqual(['Cette fonctionnalité']);
    expect(texts(root, '.pb-review-sum dt')).toEqual(['Cette fonctionnalité', 'Bogue séparé', 'Idée']);
    expect(texts(root, '.pb-review-sum dd')).toEqual(['2', '0', '1']);
    expect(region.textContent).toContain('Bugs and ideas become their own tickets either way.');
    expect(text(root, '.pb-review-note')).toBe(`note ${MARKUP}`);
    expect(region.textContent).not.toContain('Passer');
    expect(region.textContent).not.toContain('Renvoyer');
    const link = root.querySelector<HTMLAnchorElement>('a.pb-review-link')!;
    expect(link.textContent).toBe('Pass it on the feature page');
    expect(link.parentElement?.textContent).toBe(PASS_LINE);
    expect([link.getAttribute('href'), link.target, link.rel]).toEqual([
      'https://example.test/feature',
      '_blank',
      'noopener',
    ]);
    expect(texts(root, '.pb-review-warn')).toEqual([`Not sorted: “quatre ${MARKUP}” Sort it`]);
    expect(root.querySelector('img')).toBeNull();
    expect(count(root)).toBe('');
    expect(sendBack(root)!.className).toBe('pb-send pb-review-send');
    expect(sendBack(root)!.textContent).toBe('Send back to fix');
    expect(sendBack(root)!.disabled).toBe(true);

    root.querySelector<HTMLButtonElement>('.pb-review-warn button')!.click();
    expect(where(root)).toBe('4 / 4');
    label(root, 'bug').click();
    await vi.waitFor(() => expect(pressed(root)).toBe('Bogue séparé'));
    toEnd(root);
    expect(root.querySelector('.pb-review-warn')).toBeNull();
    expect(texts(root, '.pb-review-sum dd')).toEqual(['2', '1', '1']);
    expect(sendBack(root)!.disabled).toBe(false);
    sendBack(root)!.click();
    expect(actions.finish).toHaveBeenCalledOnce();

    const one = setup();
    const single = sessionWith({ comments: [comments[0]!] });
    openReviewPanel({ root: one.root, session: single, actions });
    toEnd(one.root);
    expect(text(one.root, '.pb-review-lead')).toContain('fixes the 1 comment sorted');

    for (const featureUrl of ['javascript:alert(1)', 'data:text/html,x', '/relative', 'x', '']) {
      const other = setup();
      openReviewPanel({ root: other.root, session: sessionWith({ featureUrl }), actions });
      toEnd(other.root);
      expect(other.root.querySelector('a')).toBeNull();
      expect(card(other.root).textContent).toContain(PASS_LINE);
    }
    const disabled = setup();
    const off = [{ key: 'send_back', label: 'Non', enabled: false }] as ReviewSession['finish'];
    openReviewPanel({ root: disabled.root, session: sessionWith({ finish: off }), actions });
    toEnd(disabled.root);
    expect(sendBack(disabled.root)!.disabled).toBe(true);
    const none = setup();
    openReviewPanel({ root: none.root, session: sessionWith({ finish: [] }), actions });
    toEnd(none.root);
    expect(sendBack(none.root)).toBeNull();
  });

  it('adds detail as a review comment quoting the original, then lists it under it', async () => {
    let answer!: (result: AddResult) => void;
    const add = vi.fn<NonNullable<ReviewActions['add']>>(
      () => new Promise((resolve) => (answer = resolve)),
    );
    const { root } = setup();
    const session = sessionWith({
      comments: [comment({ id: 'c-1', text: 'Le prix\nest coupé', label: 'bug' })],
    });
    openReviewPanel({ root, session, actions: actionsOf({ add }) });
    const field = () => root.querySelector<HTMLTextAreaElement>('textarea')!;
    const addButton = () => root.querySelector<HTMLButtonElement>('.pb-review-add')!;
    const type = (value: string) => {
      field().value = value;
      field().dispatchEvent(new Event('input'));
    };
    expect(field().className).toBe('pb-input pb-review-field');
    expect(field().placeholder).toBe('Add more detail to this comment…');
    expect(field().parentElement?.className).toBe('pb-review-detail');
    expect(texts(root, '.pb-actions button')).toEqual(['Add detail', 'Next']);
    expect(addButton().className).toBe('pb-ico pb-review-add');
    expect(addButton().hasAttribute('data-wide')).toBe(true);

    addButton().click();
    expect(add).not.toHaveBeenCalled();
    type('  Pareil sur le panier  ');
    addButton().click();
    expect(add).toHaveBeenCalledWith('> Le prix\n> est coupé\n\nPareil sur le panier');
    expect(addButton().disabled).toBe(true);
    expect(field().disabled).toBe(true);
    answer({ ok: false });
    await vi.waitFor(() => expect(addButton().disabled).toBe(false));
    expect(text(root, '.pb-review-notice')).toBe(FAILED);
    expect(field().value).toBe('  Pareil sur le panier  ');
    expect(root.querySelector('.pb-review-thread')).toBeNull();

    addButton().click();
    expect(add).toHaveBeenCalledTimes(2);
    answer({ ok: true });
    await vi.waitFor(() =>
      expect(texts(root, '.pb-review-thread .pb-note')).toEqual(['Added: Pareil sur le panier']),
    );
    expect(text(root, '.pb-review-thread .pb-review-added')).toBe('Added:');
    expect(field().value).toBe('');
    expect(text(root, '.pb-review-notice')).toBe('');

    // A round that closed meanwhile ends the panel like any other action.
    type('encore');
    addButton().click();
    answer({ ok: false, code: 'review_finished' });
    await vi.waitFor(() => expect(text(root, '.pb-review-notice')).toBe('Review finished.'));
    expect(root.querySelector('textarea')).toBeNull();

    const without = setup();
    openReviewPanel({ root: without.root, session, actions: actionsOf() });
    expect(without.root.querySelector('textarea, .pb-review-add')).toBeNull();
    expect(texts(without.root, '.pb-actions button')).toEqual(['Next']);
  });
});

describe('Add detail through an active review session', () => {
  const ID = 'abcdefghijklmnopqrstuv2345';
  type Batch = { id: string; review?: string; marks: { intent: { comment: string } }[] };

  afterEach(() => {
    window.location.hash = '';
    window.sessionStorage.clear();
    document.body.innerHTML = '';
  });

  it('sends the quoted text through the session route, and its retry under the same batch id', async () => {
    window.location.hash = `#pb-review${ID}`;
    const batches: Batch[] = [];
    const batchStatus = [500, 202];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init?: { body?: string }) => {
        const body = JSON.parse(init?.body ?? '{}') as { batch?: Batch };
        if (String(url).endsWith('/review/read')) {
          const comments = [comment({ id: 'c-1', text: 'The price is cut', label: 'bug' })];
          return new Response(JSON.stringify(sessionWith({ comments })), { status: 200 });
        }
        batches.push(body.batch!);
        const ack = { v: 1, ok: true, batchId: 'b', accepted: ['c-9'], trimmed: [] };
        return new Response(JSON.stringify(ack), { status: batchStatus.shift() ?? 202 });
      }),
    );
    // The collector's own send: it reads the session's route the way a pinned comment does.
    const scope = window as unknown as { __passback?: Record<string, unknown> };
    const deliver = vi.fn(async (_el: Element, words: string) => {
      const route = scope.__passback?.reviewRoute as (marks: unknown[]) => Promise<AddResult>;
      return route([{ intent: { comment: words, annotations: [] } }]);
    });
    const host = document.body.appendChild(document.createElement('div'));
    const root = host.attachShadow({ mode: 'open' });
    const load = async () => ({ send: deliver });
    const stop = activateReview({ win: window, root, host, endpoint: '/v1/ingest/demo', load });
    await vi.waitFor(() => expect(root.querySelector('textarea')).not.toBeNull());
    const field = () => root.querySelector<HTMLTextAreaElement>('textarea')!;
    const add = () => root.querySelector<HTMLButtonElement>('.pb-review-add')!;
    field().value = 'Same on the cart page';
    field().dispatchEvent(new Event('input'));
    add().click();
    await vi.waitFor(() => expect(text(root, '.pb-review-notice')).toBe(FAILED));
    expect(field().value).toBe('Same on the cart page');
    add().click();
    await vi.waitFor(() =>
      expect(text(root, '.pb-review-thread')).toBe('Added: Same on the cart page'),
    );
    expect(batches).toHaveLength(2);
    expect(batches[1]!.id).toBe(batches[0]!.id);
    expect(batches.map((batch) => batch.review)).toEqual([ID, ID]);
    expect(batches[1]!.marks[0]!.intent.comment).toBe('> The price is cut\n\nSame on the cart page');
    expect(deliver.mock.calls.map(([el]) => el)).toEqual([document.body, document.body]);
    expect(field().value).toBe('');
    stop();
    expect(scope.__passback?.reviewRoute).toBeUndefined();
  });
});
