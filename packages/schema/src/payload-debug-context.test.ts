import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { parsePayload, redact, REDACTED } from './index';

const base = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../fixtures/payloads/react-component-chain.json', import.meta.url),
    ),
    'utf8',
  ),
) as Record<string, Record<string, unknown>>;

const JWT = 'eyJhbGciOi.eyJzdWIi.c2ln';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

const full = {
  title: 'Checkout',
  widget: '1.2.3',
  appVersion: '2026.11.0',
  assets: ['/assets/app.js', '/assets/vendor.js'],
  path: ['main', 'section.cart', 'button.pay'],
  storage: { local: ['theme', 'cart'], session: ['step'] },
};

function withContext(c: Partial<typeof full> = full): unknown {
  const m = clone(base);
  if (c.title !== undefined) m.runtime!.title = c.title;
  if (c.widget !== undefined) m.code!.widget = c.widget;
  if (c.appVersion !== undefined) m.code!.appVersion = c.appVersion;
  if (c.assets !== undefined) m.code!.assets = c.assets;
  if (c.path !== undefined) m.element!.path = c.path;
  if (c.storage !== undefined) m.runtime!.storage = c.storage;
  return m;
}

function broken(section: string, key: string, value: unknown): unknown {
  const m = clone(base);
  m[section]![key] = value;
  return m;
}

const str = (n: number) => 'a'.repeat(n);
const list = (n: number, len = 1) => Array.from({ length: n }, () => str(len));

describe('payload debug context', () => {
  it('preserves debug context through parsing and redaction', () => {
    const parsed = parsePayload(withContext());
    expect(parsed.runtime.title).toBe(full.title);
    expect(parsed.code.widget).toBe(full.widget);
    expect(parsed.code.appVersion).toBe(full.appVersion);
    expect(parsed.code.assets).toEqual(full.assets);
    expect(parsed.element.path).toEqual(full.path);
    expect(parsed.runtime.storage).toEqual(full.storage);
    const out = redact(parsed);
    expect(out.runtime.title).toBe(full.title);
    expect(out.element.path).toEqual(full.path);
    expect(out.runtime.storage).toEqual(full.storage);
    expect(out.code.assets).toEqual(full.assets);
  });

  it('keeps legacy marks valid and debug context independently optional', () => {
    const legacy = parsePayload(withContext({}));
    expect('title' in legacy.runtime).toBe(false);
    expect('storage' in legacy.runtime).toBe(false);
    expect('widget' in legacy.code).toBe(false);
    expect('appVersion' in legacy.code).toBe(false);
    expect('assets' in legacy.code).toBe(false);
    expect('path' in legacy.element).toBe(false);
    for (const [k, v] of Object.entries(full)) {
      const one = parsePayload(withContext({ [k]: v }));
      const all = { ...one.code, ...one.element, ...one.runtime } as Record<string, unknown>;
      expect(all[k]).toEqual(v);
    }
  });

  it('accepts empty and maximum debug context values without reordering', () => {
    const path = Array.from({ length: 8 }, (_, i) => String(i).padEnd(120, 'p'));
    const max = parsePayload(
      withContext({
        title: str(200),
        widget: str(40),
        appVersion: str(80),
        assets: list(8, 200),
        path,
        storage: { local: list(50, 100), session: list(50, 100) },
      }),
    );
    expect(max.runtime.title).toHaveLength(200);
    expect(max.code.widget).toHaveLength(40);
    expect(max.code.appVersion).toHaveLength(80);
    expect(max.code.assets).toEqual(list(8, 200));
    expect(max.element.path).toEqual(path);
    expect(max.runtime.storage?.local).toHaveLength(50);
    expect(max.runtime.storage?.session).toHaveLength(50);
    const empty = parsePayload(
      withContext({
        title: '',
        widget: '',
        appVersion: '',
        assets: [],
        path: [],
        storage: { local: [], session: [] },
      }),
    );
    expect(empty.runtime.title).toBe('');
    expect(empty.code.assets).toEqual([]);
    expect(empty.element.path).toEqual([]);
    expect(empty.runtime.storage).toEqual({ local: [], session: [] });
  });

  it('redacts JWT-shaped debug context without mutating the mark', () => {
    const parsed = parsePayload(
      withContext({
        title: JWT,
        widget: JWT,
        appVersion: JWT,
        assets: [JWT],
        path: [JWT, 'ok'],
        storage: { local: [JWT], session: [JWT] },
      }),
    );
    const before = JSON.stringify(parsed);
    const out = redact(parsed);
    expect(JSON.stringify(parsed)).toBe(before);
    expect(out.runtime.title).toBe(REDACTED);
    expect(out.code.widget).toBe(REDACTED);
    expect(out.code.appVersion).toBe(REDACTED);
    expect(out.code.assets).toEqual([REDACTED]);
    expect(out.element.path).toEqual([REDACTED, 'ok']);
    expect(out.runtime.storage).toEqual({ local: [REDACTED], session: [REDACTED] });
    expect(parsePayload(out)).toEqual(out);
    // A secret header at the cap grows under redaction; the value is replaced whole so the mark reparses.
    const grow = (n: number) => `${str(n - 9)} cookie=x`;
    const atCap = parsePayload(
      withContext({
        title: grow(200),
        widget: grow(40),
        appVersion: grow(80),
        assets: [grow(200), 'ok.js'],
        path: ['main', grow(120)],
        storage: { local: [grow(100)], session: ['ok', grow(100)] },
      }),
    );
    const capped = redact(atCap);
    expect(capped.runtime.title).toBe(REDACTED);
    expect(capped.code.widget).toBe(REDACTED);
    expect(capped.code.appVersion).toBe(REDACTED);
    expect(capped.code.assets).toEqual([REDACTED, 'ok.js']);
    expect(capped.element.path).toEqual(['main', REDACTED]);
    expect(capped.runtime.storage).toEqual({ local: [REDACTED], session: ['ok', REDACTED] });
    expect(parsePayload(capped)).toEqual(capped);
    const short = redact(parsePayload(withContext({ title: 'Checkout cookie=x' })));
    expect(short.runtime.title).toBe(`Checkout cookie=${REDACTED}`);
  });

  it('rejects debug context beyond every declared cap', () => {
    const cases: [string, string, unknown][] = [
      ['runtime', 'title', str(201)],
      ['code', 'widget', str(41)],
      ['code', 'appVersion', str(81)],
      ['code', 'assets', list(9)],
      ['code', 'assets', [str(201)]],
      ['element', 'path', list(9)],
      ['element', 'path', [str(121)]],
      ['runtime', 'storage', { local: list(51), session: [] }],
      ['runtime', 'storage', { local: [], session: list(51) }],
      ['runtime', 'storage', { local: [str(101)], session: [] }],
      ['runtime', 'storage', { local: [], session: [str(101)] }],
    ];
    for (const [s, k, v] of cases) {
      expect(() => parsePayload(broken(s, k, v)), `${s}.${k}`).toThrow(ZodError);
    }
  });

  it('rejects null and malformed debug context', () => {
    const cases: [string, string, unknown][] = [
      ['runtime', 'title', null],
      ['runtime', 'title', 5],
      ['code', 'widget', null],
      ['code', 'widget', 1],
      ['code', 'appVersion', null],
      ['code', 'appVersion', {}],
      ['code', 'assets', null],
      ['code', 'assets', 'a.js'],
      ['code', 'assets', [1]],
      ['code', 'assets', [null]],
      ['element', 'path', null],
      ['element', 'path', 'a > b'],
      ['element', 'path', [1]],
      ['runtime', 'storage', null],
      ['runtime', 'storage', ['a']],
      ['runtime', 'storage', { local: [] }],
      ['runtime', 'storage', { session: [] }],
      ['runtime', 'storage', { local: 'a', session: [] }],
      ['runtime', 'storage', { local: [], session: [1] }],
      ['runtime', 'storage', { local: null, session: [] }],
    ];
    for (const [s, k, v] of cases) {
      expect(() => parsePayload(broken(s, k, v)), `${s}.${k}`).toThrow(ZodError);
    }
  });
});
