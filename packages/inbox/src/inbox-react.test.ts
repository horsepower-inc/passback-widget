import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parsePayload, type Payload } from '@passback/schema';
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

function withSelectors(selectors: Payload['element']['selectors']): Payload {
  const base = payloads[0]!;
  return { ...base, element: { ...base.element, selectors } };
}

const components = (n: number) => Array.from({ length: n }, (_, i) => `C${i + 1}`);

describe('inbox react path', () => {
  it('names the element by its first page selector when the React path comes first', () => {
    const payload = withSelectors([
      { kind: 'react', value: 'App > Page > Price' },
      { kind: 'testid', value: '[data-testid=price]' },
      { kind: 'css', value: 'main > span' },
    ]);
    const file = fromPayload(payload, meta);
    expect(file.selector).toBe('[data-testid=price]');
    expect(file.react).toBe('App > Page > Price');
    const text = render(file);
    const lines = text.split('\n');
    const at = lines.indexOf('selector: "[data-testid=price]"');
    expect(at).toBeGreaterThan(0);
    expect(lines[at + 1]).toBe('react: "App > Page > Price"');
    expect(parse(text)).toEqual(file);

    const onlyReact = fromPayload(withSelectors([{ kind: 'react', value: 'App > Price' }]), meta);
    expect(onlyReact.selector).toBe('');
  });

  it('writes the React path shortened to its last 8 components', () => {
    const eight = components(8).join(' > ');
    expect(fromPayload(withSelectors([{ kind: 'react', value: eight }]), meta).react).toBe(eight);

    const nine = components(9).join(' > ');
    const shortened = `… > ${components(9).slice(1).join(' > ')}`;
    const file = fromPayload(withSelectors([{ kind: 'react', value: nine }]), meta);
    expect(file.react).toBe(shortened);
    expect(render(file)).toContain(`\nreact: ${JSON.stringify(shortened)}\n`);
    expect(parse(render(file)).react).toBe(shortened);
  });

  it('writes no react line for a mark without a React path', () => {
    const payload = withSelectors([{ kind: 'testid', value: '[data-testid=price]' }]);
    const file = fromPayload(payload, meta);
    expect('react' in file).toBe(false);
    const text = render(file);
    expect(text).not.toContain('react:');
    const parsed = parse(text);
    expect('react' in parsed).toBe(false);
    expect(render(parsed)).toBe(text);
  });
});
