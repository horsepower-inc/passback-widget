import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parsePayload } from '@passback/schema';
import { fromPayload } from './inbox-file';
import { resolveChain } from './resolve';

const meta = {
  id: '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ8',
  batchId: '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ9',
  createdAt: '2026-09-19T14:00:00Z',
};

const minifiedHashIdsPath = fileURLToPath(
  new URL('../../../fixtures/payloads/minified-hash-ids.json', import.meta.url),
);
const minifiedHashIds = parsePayload(JSON.parse(readFileSync(minifiedHashIdsPath, 'utf8')));

describe('resolveChain', () => {
  it('fills file, line and col for a hash the manifest maps', () => {
    const chain = [{ name: 'e', hash: 'c7a1f3e2' }];
    const resolved = resolveChain(chain, { c7a1f3e2: 'src/components/AddToCart.tsx:12:5' });
    expect(resolved).toEqual([
      { name: 'e', hash: 'c7a1f3e2', file: 'src/components/AddToCart.tsx', line: 12, col: 5 },
    ]);
  });

  it('leaves an entry unchanged when its hash is not in the manifest', () => {
    const chain = [{ name: 'e', hash: 'c7a1f3e2' }];
    const resolved = resolveChain(chain, { other: 'src/components/AddToCart.tsx:12:5' });
    expect(resolved).toEqual(chain);
  });

  it('leaves every entry unchanged when there is no manifest', () => {
    const chain = [
      { name: 'e', hash: 'c7a1f3e2' },
      { name: 'Kt', hash: '9b04d6aa' },
    ];
    expect(resolveChain(chain)).toEqual(chain);
  });

  it('keeps an entry that already names a file', () => {
    const chain = [{ name: 'PriceTag', file: 'src/components/PriceTag.tsx', line: 14, col: 7 }];
    const resolved = resolveChain(chain, { c7a1f3e2: 'src/components/AddToCart.tsx:12:5' });
    expect(resolved).toEqual(chain);
  });

  it('reads a path that contains a colon from the right', () => {
    const chain = [{ name: 'e', hash: 'c7a1f3e2' }];
    const resolved = resolveChain(chain, { c7a1f3e2: 'C:/src/App.tsx:3:7' });
    expect(resolved).toEqual([
      { name: 'e', hash: 'c7a1f3e2', file: 'C:/src/App.tsx', line: 3, col: 7 },
    ]);
  });

  it('ignores a manifest value that is not path:line:col', () => {
    const chain = [{ name: 'e', hash: 'c7a1f3e2' }];
    expect(resolveChain(chain, { c7a1f3e2: 'src/components/AddToCart.tsx' })).toEqual(chain);
    expect(resolveChain(chain, { c7a1f3e2: 'src/components/AddToCart.tsx:abc:5' })).toEqual(chain);
    expect(resolveChain(chain, { c7a1f3e2: ':12:5' })).toEqual(chain);
    expect(resolveChain(chain, { c7a1f3e2: 'src/components/AddToCart.tsx:0:5' })).toEqual(chain);
  });

  it('ignores a hash that is only an inherited property of the manifest', () => {
    const chain = [
      { name: 'A', hash: 'toString' },
      { name: 'B', hash: '__proto__' },
    ];
    expect(resolveChain(chain, {})).toEqual(chain);
  });
});

describe('fromPayload with a manifest', () => {
  it('fromPayload writes the resolved file when the manifest maps the first hash', () => {
    const file = fromPayload(minifiedHashIds, meta, {
      c7a1f3e2: 'src/components/AddToCart.tsx:12:5',
    });
    expect(file.file).toBe('src/components/AddToCart.tsx:12:5');
  });

  it('fromPayload leaves file unset for a hashed chain without a manifest', () => {
    const file = fromPayload(minifiedHashIds, meta);
    expect(file.file).toBeUndefined();
  });
});
