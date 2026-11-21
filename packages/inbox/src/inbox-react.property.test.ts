import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parsePayload } from '@passback/schema';
import { fromPayload, parse, render } from './index';

const dir = fileURLToPath(new URL('../../../fixtures/payloads/', import.meta.url));
const payloads = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => parsePayload(JSON.parse(readFileSync(dir + f, 'utf8'))));

const meta = {
  id: '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ8',
  batchId: '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ9',
  createdAt: '2026-09-19T14:00:00Z',
};

const component = fc
  .string({ unit: 'binary', minLength: 1, maxLength: 12 })
  .filter((s) => !s.includes('\n'));

describe('inbox react line properties', () => {
  it('round-trips files with and without a react line', () => {
    fc.assert(
      fc.property(
        fc.option(fc.array(component, { minLength: 1, maxLength: 20 }), { nil: undefined }),
        (parts) => {
          const base = payloads[0]!;
          const selectors = base.element.selectors.filter((s) => s.kind !== 'react');
          const payload = {
            ...base,
            element: {
              ...base.element,
              selectors:
                parts === undefined
                  ? selectors
                  : [{ kind: 'react' as const, value: parts.join(' > ') }, ...selectors],
            },
          };
          const file = fromPayload(payload, meta);
          const out = render(file);
          expect(out.split('\n').filter((l) => l.startsWith('react: '))).toHaveLength(
            parts === undefined ? 0 : 1,
          );
          expect(parse(out)).toEqual(file);
          expect(render(parse(out))).toBe(out);
        },
      ),
      { numRuns: 200 },
    );
  });
});
