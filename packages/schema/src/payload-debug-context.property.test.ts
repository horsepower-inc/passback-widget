import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { parsePayload } from './index';

const base = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../fixtures/payloads/react-component-chain.json', import.meta.url),
    ),
    'utf8',
  ),
) as Record<string, Record<string, unknown>>;

const s = (max: number) => fc.string({ maxLength: max });
const names = (n: number, len: number) => fc.array(s(len), { maxLength: n });
const opt = <T>(a: fc.Arbitrary<T>) => fc.option(a, { nil: undefined });

const context = fc.record({
  title: opt(s(200)),
  widget: opt(s(40)),
  appVersion: opt(s(80)),
  assets: opt(names(8, 200)),
  path: opt(names(8, 120)),
  storage: opt(fc.record({ local: names(50, 100), session: names(50, 100) })),
});

function build(c: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const m = JSON.parse(JSON.stringify(base)) as Record<string, Record<string, unknown>>;
  if (c.title !== undefined) m.runtime!.title = c.title;
  if (c.storage !== undefined) m.runtime!.storage = c.storage;
  if (c.widget !== undefined) m.code!.widget = c.widget;
  if (c.appVersion !== undefined) m.code!.appVersion = c.appVersion;
  if (c.assets !== undefined) m.code!.assets = c.assets;
  if (c.path !== undefined) m.element!.path = c.path;
  return m;
}

describe('payload debug context properties', () => {
  it('round-trips bounded debug context without losing fields', () => {
    fc.assert(
      fc.property(context, (c) => {
        const mark = build(c);
        const parsed = parsePayload(mark);
        expect(parsed).toEqual(mark);
        expect(parsePayload(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
      }),
    );
  });

  const violation = fc.oneof(
    fc.nat({ max: 20 }).map((n) => ['runtime', 'title', 'a'.repeat(201 + n)] as const),
    fc.nat({ max: 20 }).map((n) => ['code', 'widget', 'a'.repeat(41 + n)] as const),
    fc.nat({ max: 20 }).map((n) => ['code', 'appVersion', 'a'.repeat(81 + n)] as const),
    fc.nat({ max: 5 }).map((n) => ['code', 'assets', Array(9 + n).fill('a')] as const),
    fc.nat({ max: 20 }).map((n) => ['code', 'assets', ['a'.repeat(201 + n)]] as const),
    fc.nat({ max: 5 }).map((n) => ['element', 'path', Array(9 + n).fill('a')] as const),
    fc.nat({ max: 20 }).map((n) => ['element', 'path', ['a'.repeat(121 + n)]] as const),
    fc
      .constantFrom('local', 'session')
      .chain((k) =>
        fc
          .nat({ max: 10 })
          .map(
            (n) =>
              [
                'runtime',
                'storage',
                { local: [], session: [], [k]: Array(51 + n).fill('a') },
              ] as const,
          ),
      ),
    fc
      .constantFrom('local', 'session')
      .chain((k) =>
        fc
          .nat({ max: 20 })
          .map(
            (n) =>
              [
                'runtime',
                'storage',
                { local: [], session: [], [k]: ['a'.repeat(101 + n)] },
              ] as const,
          ),
      ),
  );

  it('rejects generated debug context exceeding its bounds', () => {
    fc.assert(
      fc.property(violation, ([section, key, value]) => {
        const m = build({});
        m[section]![key] = value;
        expect(() => parsePayload(m)).toThrow(ZodError);
      }),
    );
  });
});
