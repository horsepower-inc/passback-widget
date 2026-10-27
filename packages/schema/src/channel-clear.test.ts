import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ChannelCleared, ChannelClear } from './index';

const SCOPES = ['fixed', 'tracker', 'workspace'] as const;

function cleared(overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    scope: 'fixed',
    comments: 2,
    attachments: 1,
    answers: 0,
    done: 3,
    settings: false,
    ...overrides,
  };
}

describe('channel clear', () => {
  it('parses a clear request for each scope', () => {
    for (const scope of SCOPES) {
      expect(ChannelClear.parse({ v: 1, scope })).toEqual({ v: 1, scope });
    }
    expect(ChannelClear.parse({ v: 1, scope: 'workspace', settings: true })).toEqual({
      v: 1,
      scope: 'workspace',
      settings: true,
    });
  });

  it('rejects a clear with settings on a scope other than workspace', () => {
    expect(() => ChannelClear.parse({ v: 1, scope: 'fixed', settings: true })).toThrow();
    expect(() => ChannelClear.parse({ v: 1, scope: 'tracker', settings: true })).toThrow();
    for (const scope of SCOPES) {
      expect(ChannelClear.parse({ v: 1, scope, settings: false })).toEqual({
        v: 1,
        scope,
        settings: false,
      });
    }
  });

  it('rejects a clear with a wrong version, an unknown scope or a missing scope', () => {
    expect(() => ChannelClear.parse({ v: 2, scope: 'fixed' })).toThrow();
    expect(() => ChannelClear.parse({ scope: 'fixed' })).toThrow();
    expect(() => ChannelClear.parse({ v: 1, scope: 'everything' })).toThrow();
    expect(() => ChannelClear.parse({ v: 1 })).toThrow();
  });

  it('parses a cleared answer with counts and rejects negative or fractional counts', () => {
    expect(ChannelCleared.parse(cleared())).toEqual(cleared());
    expect(ChannelCleared.parse(cleared({ scope: 'workspace', settings: true }))).toEqual(
      cleared({ scope: 'workspace', settings: true }),
    );
    for (const key of ['comments', 'attachments', 'answers', 'done']) {
      expect(() => ChannelCleared.parse(cleared({ [key]: -1 })), key).toThrow();
      expect(() => ChannelCleared.parse(cleared({ [key]: 1.5 })), key).toThrow();
    }
    expect(() => ChannelCleared.parse(cleared({ v: 2 }))).toThrow();
    expect(() => ChannelCleared.parse(cleared({ scope: 'all' }))).toThrow();
    expect(() => ChannelCleared.parse(cleared({ settings: 'yes' }))).toThrow();
  });

  it('round trips generated clear requests and answers', () => {
    const request = fc.oneof(
      fc.constantFrom(...SCOPES).map((scope) => ({ v: 1, scope })),
      fc
        .tuple(fc.constantFrom(...SCOPES), fc.boolean())
        .map(([scope, settings]) => ({ v: 1, scope, settings: scope === 'workspace' && settings })),
      fc.constant({ v: 1, scope: 'workspace', settings: true }),
    );
    fc.assert(
      fc.property(request, (msg) => {
        expect(ChannelClear.parse(msg)).toEqual(msg);
      }),
      { numRuns: 100 },
    );
    const count = fc.nat({ max: 100000 });
    const answer = fc.record({
      v: fc.constant(1),
      scope: fc.constantFrom(...SCOPES),
      comments: count,
      attachments: count,
      answers: count,
      done: count,
      settings: fc.boolean(),
    });
    fc.assert(
      fc.property(answer, (msg) => {
        expect(ChannelCleared.parse(msg)).toEqual(msg);
      }),
      { numRuns: 100 },
    );
  });
});
