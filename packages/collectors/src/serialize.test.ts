// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { PROPS_MAX_CHARS, toSafeJson } from './serialize';

describe('toSafeJson', () => {
  it('replaces functions and React elements with markers', () => {
    const element = { $$typeof: Symbol.for('react.element'), type: 'div', props: {} };

    expect(toSafeJson({ onClick: () => {}, icon: element })).toEqual({
      onClick: '[function]',
      icon: '[element]',
    });
  });

  it('marks a circular reference', () => {
    const node: { self?: unknown } = {};
    node.self = node;

    expect(toSafeJson(node)).toEqual({ self: '[circular]' });
  });

  it('stops at depth 3', () => {
    const nested = { a: { b: { c: { d: 1 } } } };

    expect(toSafeJson(nested)).toEqual({ a: { b: { c: '[depth]' } } });
  });

  it('cuts output over 2048 characters to a string of that length', () => {
    const big = { text: 'x'.repeat(PROPS_MAX_CHARS * 2) };

    const result = toSafeJson(big);

    expect(typeof result).toBe('string');
    expect((result as string).length).toBe(PROPS_MAX_CHARS);
  });

  it('redacts values under secret-looking keys', () => {
    expect(
      toSafeJson({ apiKey: 'abc123', password: 'hunter2', sessionToken: 'ey' + 'JhbGci' }),
    ).toEqual({ apiKey: '[redacted]', password: '[redacted]', sessionToken: '[redacted]' });
  });

  it('degrades a single throwing accessor instead of aborting collection', () => {
    const value: Record<string, unknown> = {
      safe: 'ok',
    };
    Object.defineProperty(value, 'broken', {
      enumerable: true,
      get(): unknown {
        throw new Error('boom');
      },
    });

    expect(toSafeJson(value)).toEqual({ safe: 'ok', broken: '[unavailable]' });
  });

  it('degrades a throwing accessor in an array', () => {
    const value: unknown[] = ['ok'];
    Object.defineProperty(value, 1, {
      enumerable: true,
      get(): unknown {
        throw new Error('boom');
      },
    });

    expect(toSafeJson(value)).toEqual(['ok', '[unavailable]']);
  });
});
