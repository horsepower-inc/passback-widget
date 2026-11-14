// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReviewActions } from './review-card';
import { openReviewPanel, type ReviewComment, type ReviewSession } from './review-panel';
import type { FinishResult } from './review-session';

// happy-dom proves structure and declared styles, not browser layout.
const MARKUP = '<img src=x onerror="boom()"><b>loud</b>';
const REFUSAL = { ok: false as const, reason: 'rejected' as const, message: 'non' };
const FAILED = 'Could not complete review action.';

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
const declared = (root: ShadowRoot) =>
  [...root.querySelectorAll('style')].map((style) => style.textContent ?? '').join('\n');
const text = (scope: ParentNode, selector: string) => scope.querySelector(selector)?.textContent;
const texts = (scope: ParentNode, selector: string) =>
  [...scope.querySelectorAll(selector)].map((node) => node.textContent);
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
const count = (root: ParentNode) => text(root, '.pb-bar > .pb-note');
const toEnd = (root: ParentNode) => {
  while (root.querySelector('.pb-review-next')) next(root).click();
};

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

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

describe('review panel', () => {
  it('renders the header, the pager and one comment per page in the widget classes', () => {
    const { root } = setup();
    const panel = openReviewPanel({ root, session: sessionWith(), actions: actionsOf() });
    const region = root.querySelector<HTMLElement>('[role="region"]')!;
    expect(region).toBe(panel?.element);
    expect(region.className).toBe('pb-review');
    expect(region.getAttribute('aria-label')).toBe('Revue du panier');
    expect(text(region, 'h2.pb-review-title')).toBe('Revue du panier');
    expect(text(region, '.pb-note.pb-review-meta')).toBe('2026.11-rc3 · Round 4');
    expect(where(region)).toBe('1 / 2');
    expect(pagerButtons(region).map((b) => [b.className, b.disabled])).toEqual([
      ['pb-ico', true],
      ['pb-ico', false],
    ]);
    expect(region.querySelector('.pb-review-head + .pb-review-rule')).not.toBeNull();
    expect(texts(region, '.pb-review-kind')).toEqual(['Your comment', 'Where does it go?']);
    expect(texts(region, '.pb-review-text')).toEqual(['Le bouton déborde']);
    expect(region.querySelector('.pb-review-question')).toBeNull();
    const buttons = [...region.querySelectorAll<HTMLButtonElement>('[data-pb-label]')];
    expect(buttons.map((b) => [b.className, b.hasAttribute('data-wide'), b.textContent])).toEqual([
      ['pb-ico', true, 'Cette fonctionnalité'],
      ['pb-ico', true, 'Bogue séparé'],
      ['pb-ico', true, 'Idée'],
    ]);
    expect(pressed(region)).toBe('Bogue séparé');
    expect(count(region)).toBe('2 of 2 sorted');
    expect(texts(region, '.pb-bar .pb-actions button')).toEqual(['Next']);
    expect(region.querySelector('select, option')).toBeNull();

    next(region).click();
    expect(where(region)).toBe('2 / 2');
    expect(texts(region, '.pb-review-text')).toEqual(['Pourquoi ce prix ?']);
    expect(text(region, '.pb-note.pb-review-question')).toBe('Agent asks: Vous confirmez ?');
    expect(pressed(region)).toBe('Cette fonctionnalité');

    const style = declared(root);
    expect(style).toMatch(/^\.pb-review \{[^}]*--pb-space-pad: 16px;[^}]*gap: 14px;/m);
    expect(style).toMatch(/^\.pb-review \{[^}]*background: var\(--pb-color-surface\);/m);
    expect(style).toContain('width: min(var(--pb-size-box)');
    expect(style).toMatch(/\.pb-review \.pb-ico\[aria-pressed='true'\] \{[^}]*--pb-color-main/);
    expect(style).toContain('var(--pb-z)');
    expect(style).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    expect(style).not.toMatch(/--pb-color-(ok|work|accent)/);
  });

  it('renders every server string as text and preserves line breaks', () => {
    const { root } = setup();
    const session = sessionWith({
      title: `titre ${MARKUP}`,
      version: `version ${MARKUP}`,
      labels: [{ key: 'k', label: `étiquette ${MARKUP}` }],
      comments: [
        comment({
          text: `texte ${MARKUP}\nseconde ligne`,
          label: null,
          tone: 'ask',
          question: `question ${MARKUP}\nseconde ligne`,
        }),
      ],
    });
    const region = openReviewPanel({ root, session, actions: actionsOf() })!.element;
    expect(region.querySelector('img, b')).toBeNull();
    expect(region.getAttribute('aria-label')).toBe(`titre ${MARKUP}`);
    expect(text(region, 'h2')).toBe(`titre ${MARKUP}`);
    expect(text(region, '.pb-review-version')).toBe(`version ${MARKUP}`);
    expect(text(region, '[data-pb-label="k"]')).toBe(`étiquette ${MARKUP}`);
    expect(text(region, '.pb-review-text')).toBe(`texte ${MARKUP}\nseconde ligne`);
    expect(text(region, '.pb-review-question')).toBe(
      `Agent asks: question ${MARKUP}\nseconde ligne`,
    );
    toEnd(region);
    expect(text(region, '.pb-review-warn')).toBe(
      `Not sorted: “texte ${MARKUP}\nseconde ligne” Sort it`,
    );
    expect(region.querySelector('img')).toBeNull();
    expect(declared(root)).toMatch(/^\.pb-review \{[^}]*white-space: pre-wrap;/m);
  });

  it('renders without client actions network storage timers or input mutation', async () => {
    const { root } = setup();
    const fetchSpy = vi.fn();
    const xhr = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('XMLHttpRequest', xhr);
    const timers = [
      vi.spyOn(globalThis, 'setTimeout'),
      vi.spyOn(globalThis, 'setInterval'),
      vi.spyOn(globalThis, 'requestAnimationFrame'),
    ];
    const storage = [
      vi.spyOn(Storage.prototype, 'getItem'),
      vi.spyOn(Storage.prototype, 'setItem'),
    ];
    const created = vi.spyOn(Document.prototype, 'createElement');
    const scope = globalThis as { __passback?: Record<string, unknown> };
    const shot = (): undefined => undefined;
    const prior = scope.__passback;
    scope.__passback = { shot };
    vi.resetModules();
    const fresh = await import('./review-panel');
    expect(scope.__passback.reviewPanel).toBe(fresh.openReviewPanel);
    expect(scope.__passback.shot).toBe(shot);
    expect(created).not.toHaveBeenCalled();
    expect(root.childNodes).toHaveLength(0);
    scope.__passback = prior;

    const session = deepFreeze(sessionWith());
    const before = structuredClone(session);
    const panel = fresh.openReviewPanel({ root, session });
    expect(panel).toBeDefined();
    expect(session).toEqual(before);
    expect(root.querySelector('input, textarea, select, form')).toBeNull();
    expect(root.querySelector('[onclick], [tabindex], [contenteditable]')).toBeNull();
    const labels = [...root.querySelectorAll<HTMLButtonElement>('[data-pb-label]')];
    expect(labels.map((button) => button.disabled)).toEqual([true, true, true]);
    toEnd(root);
    expect(sendBack(root)).toBeNull();
    expect(panel?.element.textContent).not.toContain('Renvoyer');
    expect(panel?.element.textContent).not.toContain('corrigé');
    for (const spy of [fetchSpy, xhr, ...timers, ...storage]) expect(spy).not.toHaveBeenCalled();
    panel?.close();
    for (const spy of [fetchSpy, xhr, ...timers, ...storage]) expect(spy).not.toHaveBeenCalled();
  });

  it('accepts string fix lines while keeping session registration inert', async () => {
    const { root } = setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const timer = vi.spyOn(globalThis, 'setTimeout');
    const read = vi.spyOn(Storage.prototype, 'getItem');
    const scope = globalThis as { __passback?: Record<string, unknown> };
    const prior = scope.__passback;
    scope.__passback = {};
    vi.resetModules();
    const fresh = await import('./review-panel');
    const { createReviewSession } = await import('./review-session');
    expect(scope.__passback.reviewSession).toBe(createReviewSession);
    scope.__passback = prior;
    const panel = fresh.openReviewPanel({ root, session: sessionWith() });
    expect(panel?.element.textContent).not.toContain('L12');
    for (const spy of [fetchSpy, timer, read]) expect(spy).not.toHaveBeenCalled();
  });

  it('cleans up partial rendering and contains host DOM failures', () => {
    const { doc, root } = setup();
    const kept = doc.createElement('div');
    root.append(kept);
    const ownerAppend = root.append.bind(root);
    const append = vi.spyOn(root, 'append').mockImplementation((...nodes) => {
      ownerAppend(...nodes);
      throw new Error('host says no');
    });
    expect(openReviewPanel({ root, session: sessionWith() })).toBeUndefined();
    expect(append).toHaveBeenCalledOnce();
    expect([...root.childNodes]).toEqual([kept]);
    append.mockRestore();

    const hostile = sessionWith();
    Object.defineProperty(hostile, 'comments', {
      get() {
        throw new Error('bad session');
      },
    });
    expect(openReviewPanel({ root, session: hostile })).toBeUndefined();
    expect([...root.childNodes]).toEqual([kept]);
    expect(
      openReviewPanel(undefined as unknown as Parameters<typeof openReviewPanel>[0]),
    ).toBeUndefined();

    const panel = openReviewPanel({ root, session: sessionWith() });
    vi.spyOn(panel?.element as HTMLElement, 'remove').mockImplementation(() => {
      throw new Error('host says no');
    });
    expect(() => panel?.close()).not.toThrow();
  });

  it('renders held finished and expired review results as text in the same frame', async () => {
    const answers: FinishResult[] = [
      { ...REFUSAL, code: 'review_held', comments: ['c-1', `inconnu ${MARKUP}`] },
      { ...REFUSAL, code: 'review_finished' },
    ];
    const finish = vi.fn<ReviewActions['finish']>(async () => answers.shift()!);
    const actions = actionsOf({ finish });
    const { root } = setup();
    const session = sessionWith({
      comments: [comment({ id: 'c-1', text: `retenu ${MARKUP}`, label: 'feature' })],
    });
    openReviewPanel({ root, session, actions });
    const notice = () => text(root, '.pb-review-notice');
    toEnd(root);
    sendBack(root)!.click();
    expect(sendBack(root)!.disabled).toBe(true);
    await vi.waitFor(() => expect(sendBack(root)!.disabled).toBe(false));
    expect(notice()).toBe('Resolve these comments before sending back.');
    expect(texts(root, '.pb-review-held li')).toEqual([`retenu ${MARKUP}`, `inconnu ${MARKUP}`]);
    expect(root.querySelector('img')).toBeNull();

    sendBack(root)!.click();
    await vi.waitFor(() => expect(notice()).toBe('Review finished.'));
    expect(texts(root, '.pb-review-held li')).toEqual([]);
    expect(sendBack(root)!.disabled).toBe(true);
    expect(root.querySelector('.pb-review-pager, [data-pb-label]')).toBeNull();
    expect(root.querySelector('.pb-review-title + .pb-review-meta')).not.toBeNull();

    const expired = setup();
    const panel = openReviewPanel({ root: expired.root, session, actions })!;
    panel.end('review_expired');
    expect(text(expired.root, '.pb-review-notice')).toBe('Review expired.');
    expect(sendBack(expired.root)!.disabled).toBe(true);
    panel.update({ ...session, title: 'plus tard' });
    expect(text(expired.root, 'h2')).toBe(session.title);

    const done = setup();
    finish.mockResolvedValueOnce({
      ok: true,
      summary: [{ label: `libellé ${MARKUP}`, value: `valeur ${MARKUP}` }],
    });
    openReviewPanel({ root: done.root, session, actions });
    toEnd(done.root);
    sendBack(done.root)!.click();
    await vi.waitFor(() =>
      expect(text(done.root, '.pb-review-summary')).toBe(`libellé ${MARKUP}: valeur ${MARKUP}`),
    );
    expect(done.root.querySelector('img')).toBeNull();
    expect(sendBack(done.root)!.disabled).toBe(true);
    expect(text(done.root, 'a')).toBe('Open feature');
  });

  it('keeps the last state and allows a retry when an action throws or fails', async () => {
    const actions = actionsOf({
      overrule: vi.fn<ReviewActions['overrule']>(() => {
        throw new Error('boom');
      }),
      finish: vi.fn<ReviewActions['finish']>(async () => {
        throw new Error('boom');
      }),
    });
    const { root } = setup();
    openReviewPanel({ root, session: sessionWith(), actions });
    const notice = () => text(root, '.pb-review-notice');
    label(root, 'idea').click();
    await vi.waitFor(() => expect(notice()).toBe(FAILED));
    expect(pressed(root)).toBe('Bogue séparé');
    expect(label(root, 'idea').disabled).toBe(false);
    toEnd(root);
    sendBack(root)!.click();
    await vi.waitFor(() => expect(sendBack(root)!.disabled).toBe(false));
    expect(notice()).toBe(FAILED);
    expect(root.querySelector('[role="region"]')).not.toBeNull();
  });

  it('keeps the keyboard and the controls across a poll, and ignores answers after close', async () => {
    const { root, host } = setup();
    let answer!: (result: Awaited<ReturnType<ReviewActions['overrule']>>) => void;
    const actions = actionsOf({
      overrule: vi.fn<ReviewActions['overrule']>(
        () => new Promise((resolve) => (answer = resolve)),
      ),
      add: vi.fn<NonNullable<ReviewActions['add']>>(),
    });
    document.body.append(host);
    const session = sessionWith();
    const panel = openReviewPanel({ root, session, actions })!;
    const before = label(root, 'bug');
    panel.update({ ...session, cursor: 'c-2', expiresAt: 'later' });
    expect(label(root, 'bug')).toBe(before);
    next(root).focus();
    panel.update({ ...session, title: 'Autre' });
    expect(text(root, 'h2')).toBe('Autre');
    expect(root.activeElement).toBe(next(root));

    const field = root.querySelector<HTMLTextAreaElement>('textarea')!;
    field.focus();
    field.value = 'abcdef';
    field.dispatchEvent(new Event('input'));
    field.setSelectionRange(2, 4);
    panel.update({ ...session, title: 'Encore' });
    const again = root.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(again).not.toBe(field);
    expect(root.activeElement).toBe(again);
    expect([again.value, again.selectionStart, again.selectionEnd]).toEqual(['abcdef', 2, 4]);

    label(root, 'idea').focus();
    label(root, 'idea').click();
    panel.close();
    answer({ ok: true, comment: 'c-9', status: 's' });
    await Promise.resolve();
    expect(root.childNodes).toHaveLength(0);
    expect(() => panel.update(session)).not.toThrow();
    expect(() => panel.end('review_finished')).not.toThrow();
    expect(root.childNodes).toHaveLength(0);
  });

  it('closes idempotently without removing unrelated widget nodes', () => {
    const { doc, root } = setup();
    const widget = doc.createElement('div');
    const widgetStyle = doc.createElement('style');
    root.append(widgetStyle, widget);
    const other = openReviewPanel({ root, session: sessionWith() });
    const panel = openReviewPanel({ root, session: sessionWith({ title: 'Autre' }) });
    expect(root.querySelectorAll('[role="region"]')).toHaveLength(2);
    expect(root.querySelectorAll('style')).toHaveLength(3);
    panel?.close();
    panel?.close();
    expect(panel?.element.isConnected).toBe(false);
    expect(widget.parentNode).toBe(root);
    expect(widgetStyle.parentNode).toBe(root);
    expect(other?.element.parentNode).toBe(root);
    expect(root.querySelectorAll('style')).toHaveLength(2);
    other?.close();
    expect([...root.childNodes]).toEqual([widgetStyle, widget]);
  });
});
