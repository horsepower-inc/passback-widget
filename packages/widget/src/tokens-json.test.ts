import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCHEME, SCHEMES, TOKENS } from './tokens';

type Node = Record<string, unknown>;
type JsonToken = { $value: unknown; $type: unknown; $extensions?: Node };

const file = JSON.parse(readFileSync(new URL('../tokens.json', import.meta.url), 'utf8')) as Node;

const isNode = (v: unknown): v is Node => typeof v === 'object' && v !== null;

function collect(node: Node, path: string[], out: Map<string, JsonToken>): Map<string, JsonToken> {
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith('$') || !isNode(child)) continue;
    const next = [...path, key];
    if ('$value' in child) out.set(`--${next.join('-')}`, child as JsonToken);
    else collect(child, next, out);
  }
  return out;
}

const tokensOf = (tree: Node): Map<string, JsonToken> => collect(tree, [], new Map());

const sharedNames = Object.keys(TOKENS);
const colorNames = Object.keys(SCHEMES.dark);

function colorMatches(tok: JsonToken | undefined, name: string): boolean {
  const scheme = tok?.$extensions?.['passback.scheme'] as Node | undefined;
  return (
    tok?.$value === SCHEMES[DEFAULT_SCHEME][name] &&
    scheme?.light === SCHEMES.light[name] &&
    scheme?.dark === SCHEMES.dark[name]
  );
}

function differing(tree: Node): string[] {
  const found = tokensOf(tree);
  const shared = sharedNames.filter((name) => found.get(name)?.$value !== TOKENS[name]);
  const colors = colorNames.filter((name) => !colorMatches(found.get(name), name));
  return [...shared, ...colors];
}

describe('tokens.json', () => {
  const found = tokensOf(file);

  it('names exactly the tokens of the style kit', () => {
    const expected = [...sharedNames, ...colorNames].sort();
    expect(expected).toHaveLength(35);
    expect([...found.keys()].sort()).toEqual(expected);
  });

  it('holds the same value as the stylesheet for every shared token', () => {
    for (const name of sharedNames) expect(found.get(name)?.$value, name).toBe(TOKENS[name]);
  });

  it('holds the light and the dark value of every colour', () => {
    for (const name of colorNames) {
      const scheme = found.get(name)?.$extensions?.['passback.scheme'] as Node | undefined;
      expect(scheme?.light, name).toBe(SCHEMES.light[name]);
      expect(scheme?.dark, name).toBe(SCHEMES.dark[name]);
      expect(found.get(name)?.$value, name).toBe(SCHEMES[DEFAULT_SCHEME][name]);
    }
  });

  it('exports the Inbox pin dimension as a dimension token', () => {
    const pin = found.get('--pb-size-pin');
    expect(pin?.$value).toBe('16px');
    expect(pin?.$type).toBe('dimension');
    expect(pin?.$value).toBe(TOKENS['--pb-size-pin']);
  });

  it('R4b exports glow and flame identically in both themes', () => {
    for (const [key, v] of Object.entries({ glow: '#ffd400', flame: '#ff7a00' })) {
      const tok = found.get(`--pb-color-${key}`);
      const scheme = tok?.$extensions?.['passback.scheme'] as Node | undefined;
      expect([tok?.$value, scheme?.light, scheme?.dark], key).toEqual([v, v, v]);
    }
  });

  it('gives every token a string value and a type', () => {
    expect(found.size).toBe(35);
    for (const [name, tok] of found) {
      expect(typeof tok.$value === 'string' && tok.$value !== '', name).toBe(true);
      expect(typeof tok.$type === 'string' && tok.$type !== '', name).toBe(true);
      if (sharedNames.includes(name))
        expect(tok.$extensions?.['passback.scheme'], name).toBeUndefined();
    }
  });

  it('fails on a value that differs from the stylesheet', () => {
    expect(differing(file)).toEqual([]);
    const copy = JSON.parse(JSON.stringify(file)) as {
      pb: { color: { surface: { $value: string } } };
    };
    copy.pb.color.surface.$value = '#000000';
    expect(differing(copy)).toEqual(['--pb-color-surface']);
  });
});
