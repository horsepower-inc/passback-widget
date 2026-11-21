// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReviewActions } from './review-card';
import { openReviewPanel, type ReviewComment, type ReviewSession } from './review-panel';

const later = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  const doc = document.implementation.createHTMLDocument('');
  const host = doc.createElement('div');
  doc.body.append(host);
  return { root: host.attachShadow({ mode: 'open' }) };
}

const note = (id: string): ReviewComment => ({
  id,
  mark: `m-${id}`,
  text: `Comment ${id}`,
  label: 'feature',
  status: 'open',
  tone: 'plain',
  overruled: false,
});

function sessionWith(overrides: Partial<ReviewSession> = {}): ReviewSession {
  return {
    v: 1,
    state: 'open',
    title: 'Cart review',
    version: '1.0',
    round: 2,
    check: 'Works?',
    labels: [{ key: 'feature', label: 'Feature' }],
    finish: [{ key: 'send_back', label: 'Send back', enabled: true }],
    fixes: [
      { comment: 'a', text: 'Wrapped <b>the</b> button', line: 'cart.ts:12' },
      { comment: 'b', text: 'Raised the limit', line: 'cart.ts:40' },
    ],
    featureUrl: 'https://example.test/feature',
    expiresAt: '2026-11-03T00:00:00Z',
    cursor: 'c1',
    comments: [note('a'), note('b')],
    ...overrides,
  };
}

function actionsOf() {
  return {
    overrule: vi.fn<ReviewActions['overrule']>(async (id) => ({
      ok: true,
      comment: id,
      status: 's',
    })),
    finish: vi.fn<ReviewActions['finish']>(async () => ({ ok: true, summary: [] })),
  };
}

const choice = (root: ParentNode, verdict: string) =>
  root.querySelector<HTMLButtonElement>(`[data-pb-verdict="${verdict}"]`)!;
const chosen = (root: ParentNode) =>
  [...root.querySelectorAll('[data-pb-verdict][aria-pressed="true"]')].map(
    (node) => (node as HTMLElement).dataset.pbVerdict,
  );
const next = (root: ParentNode) => root.querySelector<HTMLButtonElement>('.pb-review-next')!;
const prev = (root: ParentNode) =>
  root.querySelector<HTMLButtonElement>('[data-pb-focus="#pager:Previous"]')!;
const sendBack = (root: ParentNode) => root.querySelector<HTMLButtonElement>('.pb-review-send')!;
const toEnd = (root: ParentNode) => {
  while (root.querySelector('.pb-review-next')) next(root).click();
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('review verdicts', () => {
  it('shows supplied fixes and sends selected verdicts through the panel action', async () => {
    const { root } = setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const actions = actionsOf();
    openReviewPanel({ root, session: sessionWith(), actions });
    expect(root.querySelector('.pb-review-fix')?.textContent).toBe('Wrapped <b>the</b> button');
    expect(root.querySelector('.pb-review-fix b')).toBeNull();
    expect(root.querySelector('.pb-review-fix-line')?.textContent).toBe('cart.ts:12');
    expect(choice(root, 'fixed').textContent).toBe('Fixed');
    expect(choice(root, 'still_wrong').textContent).toBe('Still wrong');
    expect(root.querySelector('[role="group"][aria-label="Is it fixed?"]')).not.toBeNull();
    choice(root, 'fixed').click();
    expect(chosen(root)).toEqual(['fixed']);
    choice(root, 'still_wrong').click();
    expect(chosen(root)).toEqual(['still_wrong']);
    next(root).click();
    choice(root, 'fixed').click();
    expect(fetchSpy).not.toHaveBeenCalled();
    toEnd(root);
    sendBack(root).click();
    await later();
    expect(actions.finish).toHaveBeenCalledTimes(1);
    expect(actions.finish).toHaveBeenCalledWith([
      { comment: 'a', verdict: 'still_wrong' },
      { comment: 'b', verdict: 'fixed' },
    ]);
  });

  it('preserves verdicts across paging and unchanged updates and clears stale choices', () => {
    const { root } = setup();
    const panel = openReviewPanel({ root, session: sessionWith(), actions: actionsOf() })!;
    choice(root, 'still_wrong').click();
    next(root).click();
    choice(root, 'fixed').click();
    prev(root).click();
    expect(chosen(root)).toEqual(['still_wrong']);
    panel.update(sessionWith({ cursor: 'c2' }));
    expect(chosen(root)).toEqual(['still_wrong']);
    // a's fix changes: its choice goes, b's stays
    const fixes = [
      { comment: 'a', text: 'Another fix', line: 'cart.ts:12' },
      { comment: 'b', text: 'Raised the limit', line: 'cart.ts:40' },
    ];
    panel.update(sessionWith({ fixes }));
    expect(chosen(root)).toEqual([]);
    next(root).click();
    expect(chosen(root)).toEqual(['fixed']);
    // b's comment disappears
    panel.update(sessionWith({ fixes, comments: [note('a')] }));
    panel.update(sessionWith({ fixes }));
    while (root.querySelector('.pb-review-where')?.textContent !== '2 / 2') {
      const where = root.querySelector('.pb-review-where')?.textContent;
      (where === 'Done' ? prev(root) : next(root)).click();
    }
    expect(chosen(root)).toEqual([]);
    // a new round clears everything
    choice(root, 'fixed').click();
    panel.update(sessionWith({ fixes, round: 3 }));
    expect(chosen(root)).toEqual([]);
  });

  it('ignores unmatched fixes and preserves sessions without fix choices', async () => {
    const { root } = setup();
    const actions = actionsOf();
    const fixes = [{ comment: 'zzz', text: 'orphan', line: 'x.ts:1' }];
    openReviewPanel({ root, session: sessionWith({ fixes }), actions });
    expect(root.querySelector('[data-pb-verdict]')).toBeNull();
    expect(root.textContent).not.toContain('orphan');
    expect(root.querySelectorAll('.pb-review-text')).toHaveLength(1);
    toEnd(root);
    sendBack(root).click();
    await later();
    expect(actions.finish).toHaveBeenCalledWith();
  });

  it('contains verdict failures and ignores verdict actions after close', async () => {
    const { root } = setup();
    const actions = actionsOf();
    actions.finish.mockResolvedValueOnce({ ok: false, reason: 'rejected', message: 'no' });
    const panel = openReviewPanel({ root, session: sessionWith(), actions })!;
    choice(root, 'fixed').click();
    toEnd(root);
    sendBack(root).click();
    await later();
    // refused: the selection stays and a retry sends it again
    prev(root).click();
    prev(root).click();
    expect(chosen(root)).toEqual(['fixed']);
    toEnd(root);
    let answer: (value: { ok: true; summary: [] }) => void = () => {};
    actions.finish.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const retained = sendBack(root);
    retained.click();
    // pending: the retained button cannot send the verdicts twice
    retained.click();
    expect(actions.finish).toHaveBeenCalledTimes(2);
    answer({ ok: true, summary: [] });
    await later();
    expect(actions.finish).toHaveBeenLastCalledWith([{ comment: 'a', verdict: 'fixed' }]);
    // finished: no further choice, and the retained button sends nothing more
    expect(root.querySelector('[data-pb-verdict]')).toBeNull();
    retained.click();
    await later();
    expect(actions.finish).toHaveBeenCalledTimes(2);
    const second = setup();
    const again = actionsOf();
    const open = openReviewPanel({ root: second.root, session: sessionWith(), actions: again })!;
    const button = choice(second.root, 'fixed');
    button.click();
    toEnd(second.root);
    const send = sendBack(second.root);
    open.close();
    expect(() => button.click()).not.toThrow();
    // closed: the retained Send back submits nothing
    expect(() => send.click()).not.toThrow();
    await later();
    expect(second.root.childNodes).toHaveLength(0);
    expect(again.finish).not.toHaveBeenCalled();
    panel.close();
  });
});
