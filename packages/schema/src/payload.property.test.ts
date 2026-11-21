import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { MAX_BATCH_MARKS, parseBatch, parsePayload } from './index';

const dir = fileURLToPath(new URL('../../../fixtures/payloads/', import.meta.url));
const fixtures = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(dir + f, 'utf8')) as unknown);

function leafPaths(value: unknown): (string | number)[][] {
  const paths: (string | number)[][] = [];

  function walk(node: unknown, path: (string | number)[]): void {
    if (path[0] === 'runtime' && (path[1] === 'props' || path[1] === 'store')) return;

    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, [...path, i]));
      return;
    }

    if (node !== null && typeof node === 'object') {
      for (const [key, v] of Object.entries(node)) {
        walk(v, [...path, key]);
      }
      return;
    }

    if (path.length > 0) paths.push(path);
  }

  walk(value, []);
  return paths;
}

function withLeaf(value: unknown, path: (string | number)[], next: unknown): unknown {
  const clone = structuredClone(value);
  let node = clone as Record<string | number, unknown>;
  for (let i = 0; i < path.length - 1; i++) {
    node = node[path[i]!] as Record<string | number, unknown>;
  }
  node[path[path.length - 1]!] = next;
  return clone;
}

function readLeaf(value: unknown, path: (string | number)[]): unknown {
  let node: unknown = value;
  for (const key of path) {
    node = (node as Record<string | number, unknown>)[key];
  }
  return node;
}

describe('schema properties', () => {
  it('round-trips every fixture payload through JSON and parsePayload', () => {
    fc.assert(
      fc.property(fc.constantFrom(...fixtures), (fixture) => {
        const expected = parsePayload(fixture);
        const actual = parsePayload(JSON.parse(JSON.stringify(expected)));
        expect(actual).toEqual(expected);
      }),
      { numRuns: 200 },
    );
  });

  it('rejects a fixture with one leaf changed to another JSON type with a ZodError', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...fixtures).chain((fixture) =>
          fc.integer({ min: 0, max: leafPaths(fixture).length - 1 }).chain((index) => {
            const path = leafPaths(fixture)[index]!;
            const original = readLeaf(fixture, path);
            const nextArb = typeof original === 'string' ? fc.integer() : fc.string();
            return nextArb.map((next) => ({ fixture, path, next }));
          }),
        ),
        ({ fixture, path, next }) => {
          const mutated = withLeaf(fixture, path, next);
          expect(() => parsePayload(mutated)).toThrow(ZodError);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('rejects a fixture missing any top-level field except repro with a ZodError', () => {
    fc.assert(
      fc.property(
        fc
          .constantFrom(...fixtures)
          .chain((fixture) =>
            fc
              .constantFrom(
                ...Object.keys(fixture as Record<string, unknown>).filter((key) => key !== 'repro'),
              )
              .map((key) => ({ fixture, key })),
          ),
        ({ fixture, key }) => {
          const mutated = { ...(fixture as Record<string, unknown>) };
          delete mutated[key];
          expect(() => parsePayload(mutated)).toThrow(ZodError);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('round-trips a batch of 1 to 20 fixture marks through parseBatch', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...fixtures), { minLength: 1, maxLength: MAX_BATCH_MARKS }),
        fc.date({
          min: new Date('2000-01-01T00:00:00Z'),
          max: new Date('2099-12-31T23:59:59Z'),
          noInvalidDate: true,
        }),
        (marks, createdAt) => {
          const batch = {
            schemaVersion: 1 as const,
            id: '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ8',
            createdAt: createdAt.toISOString(),
            marks,
          };
          expect(() => parseBatch(batch)).not.toThrow();
        },
      ),
      { numRuns: 200 },
    );
  });

  it('rejects a batch of more than 20 marks with a ZodError', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...fixtures), { minLength: MAX_BATCH_MARKS + 1, maxLength: 25 }),
        (marks) => {
          const batch = {
            schemaVersion: 1 as const,
            id: '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ8',
            createdAt: new Date().toISOString(),
            marks,
          };
          expect(() => parseBatch(batch)).toThrow(ZodError);
        },
      ),
      { numRuns: 200 },
    );
  });
});
