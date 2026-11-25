// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Payload, Runtime } from '@passback/schema';
import { redact } from '@passback/schema/redact';
import { collectRuntime } from './runtime';

interface FakeStore {
  readonly keys: string[];
  readonly values: Map<string, string>;
  valueReads: number;
  failLength?: boolean;
  failKeyAt?: number;
  nullKeyAt?: number;
  readonly store: Storage;
}

function fakeStore(entries: Record<string, string> = {}): FakeStore {
  const state: FakeStore = {
    keys: Object.keys(entries),
    values: new Map(Object.entries(entries)),
    valueReads: 0,
    store: undefined as unknown as Storage,
  };
  const store = {
    get length(): number {
      if (state.failLength) throw new Error('length');
      return state.keys.length;
    },
    key(i: number): string | null {
      if (state.failKeyAt === i) throw new Error('key');
      if (state.nullKeyAt === i) return null;
      return state.keys[i] ?? null;
    },
    getItem(k: string): string | null {
      state.valueReads++;
      return state.values.get(k) ?? null;
    },
    setItem(): void {
      throw new Error('mutation');
    },
    removeItem(): void {
      throw new Error('mutation');
    },
    clear(): void {
      throw new Error('mutation');
    },
  };
  return Object.assign(state, { store: store as unknown as Storage });
}

interface FakeWin {
  readonly win: Window;
  readonly cookieReads: () => number;
}

function fakeWindow(local: () => Storage, session: () => Storage): FakeWin {
  let cookieReads = 0;
  const win = {
    location: new URL('https://example.test/page'),
    get localStorage(): Storage {
      return local();
    },
    get sessionStorage(): Storage {
      return session();
    },
    get document(): unknown {
      return {
        get cookie(): string {
          cookieReads++;
          return 'sid=synthetic';
        },
      };
    },
  };
  return { win: win as unknown as Window, cookieReads: () => cookieReads };
}

function collect(win: Window): Runtime {
  return collectRuntime(document.createElement('div'), win);
}

function markWith(runtime: Runtime): Payload {
  return {
    schemaVersion: 1,
    code: { framework: 'react', chain: [] },
    element: { selectors: [], tag: 'div', attrs: {}, text: '', outerHTML: '<div></div>' },
    visual: {
      rects: {
        self: { x: 0, y: 0, width: 0, height: 0 },
        parent: { x: 0, y: 0, width: 0, height: 0 },
      },
      styles: {},
      flags: { clipped: false, covered: false, offViewport: false },
    },
    runtime,
    timeline: [],
    environment: {
      ua: 'test',
      viewport: [0, 0],
      dpr: 1,
      locale: 'en',
      tz: 'UTC',
      colorScheme: 'light',
      reducedMotion: false,
    },
    intent: { comment: '', annotations: [] },
  };
}

describe('collectRuntime storage names', () => {
  it('captures sorted storage names in a mark without reading values', () => {
    const local = fakeStore({ zeta: 'value-local-one', alpha: 'value-local-two' });
    const session = fakeStore({ beta: 'value-session-one', Alpha: 'value-session-two' });
    const { win } = fakeWindow(
      () => local.store,
      () => session.store,
    );
    const runtime = collect(win);
    expect(runtime.storage).toEqual({ local: ['alpha', 'zeta'], session: ['Alpha', 'beta'] });
    expect(local.valueReads + session.valueReads).toBe(0);
    const mark = Payload.parse(markWith(runtime));
    const text = JSON.stringify(mark);
    for (const v of [
      'value-local-one',
      'value-local-two',
      'value-session-one',
      'value-session-two',
    ]) {
      expect(text).not.toContain(v);
    }
    expect(text).toContain('"zeta"');
  });

  it('captures storage names without reading document.cookie', () => {
    const local = fakeStore({ a: '1' });
    const session = fakeStore({ b: '2' });
    const { win, cookieReads } = fakeWindow(
      () => local.store,
      () => session.store,
    );
    expect(collect(win).storage).toEqual({ local: ['a'], session: ['b'] });
    expect(cookieReads()).toBe(0);
  });

  it('sorts storage names before applying the name and list caps', () => {
    const many: Record<string, string> = {};
    for (let i = 59; i >= 0; i--) many[`k${String(i).padStart(2, '0')}`] = 'v';
    const local = fakeStore(many);
    const long = 'x'.repeat(150);
    const session = fakeStore({ [`${long}b`]: 'v', [`${long}a`]: 'v', ['y'.repeat(100)]: 'v' });
    const { win } = fakeWindow(
      () => local.store,
      () => session.store,
    );
    const storage = collect(win).storage!;
    expect(storage.local).toHaveLength(50);
    expect(storage.local[0]).toBe('k00');
    expect(storage.local[49]).toBe('k49');
    expect(storage.session).toEqual(['x'.repeat(100), 'x'.repeat(100), 'y'.repeat(100)]);
    expect(Runtime.safeParse(collect(win)).success).toBe(true);
  });

  it('omits empty storage and preserves a populated companion list', () => {
    const empty = () => fakeStore().store;
    const one = () => fakeStore({ k: 'v' }).store;
    expect(collect(fakeWindow(empty, empty).win)).not.toHaveProperty('storage');
    expect(collect(fakeWindow(one, empty).win).storage).toEqual({ local: ['k'], session: [] });
    expect(collect(fakeWindow(empty, one).win).storage).toEqual({ local: [], session: ['k'] });
  });

  it('reflects storage changes on repeated collection without mutating storage', () => {
    const local = fakeStore({ a: '1', b: '2' });
    const session = fakeStore();
    const { win } = fakeWindow(
      () => local.store,
      () => session.store,
    );
    expect(collect(win).storage).toEqual({ local: ['a', 'b'], session: [] });
    local.keys.splice(0, 1, 'c');
    local.keys.push('0');
    expect(collect(win).storage).toEqual({ local: ['0', 'b', 'c'], session: [] });
    local.nullKeyAt = 1;
    expect(collect(win).storage).toEqual({ local: ['0', 'c'], session: [] });
    expect(local.keys).toEqual(['c', 'b', '0']);
    expect(local.valueReads).toBe(0);
  });

  it('omits storage when access or enumeration throws without escaping collection', () => {
    const fail = (): Storage => {
      throw new Error('blocked');
    };
    const good = () => fakeStore({ k: 'v' });
    const cases: Array<[string, () => Window]> = [];
    cases.push(['local accessor', () => fakeWindow(fail, () => good().store).win]);
    cases.push(['session accessor', () => fakeWindow(() => good().store, fail).win]);
    for (const [name, mutate] of [
      ['length', (s: FakeStore) => (s.failLength = true)],
      ['key', (s: FakeStore) => (s.failKeyAt = 1)],
    ] as const) {
      cases.push([
        `local ${name}`,
        () => {
          const s = fakeStore({ a: '1', b: '2' });
          mutate(s);
          return fakeWindow(
            () => s.store,
            () => good().store,
          ).win;
        },
      ]);
      cases.push([
        `session ${name}`,
        () => {
          const s = fakeStore({ a: '1', b: '2' });
          mutate(s);
          return fakeWindow(
            () => good().store,
            () => s.store,
          ).win;
        },
      ]);
    }
    for (const [label, make] of cases) {
      const runtime = collect(make());
      expect(runtime, label).not.toHaveProperty('storage');
      expect(runtime.url, label).toBe('https://example.test/page');
      expect(runtime.route, label).toBe('/page');
    }
    const ok = fakeWindow(
      () => good().store,
      () => good().store,
    ).win;
    expect(collect(ok).storage).toEqual({ local: ['k'], session: ['k'] });
  });
  it('redacts a JWT-shaped storage name before truncating it', () => {
    // Synthetic token whose second dot sits past character 100: cutting first would hide it from redact().
    const claims = `eyJzdWIiOiJzeW50aGV0aWMtdXNlciJ9${'A'.repeat(90)}`;
    const name = `eyJhbGciOiJIUzI1NiJ9.${claims}.c2lnbmF0dXJl`;
    expect(name.indexOf('.', 21)).toBeGreaterThan(100);
    const local = fakeStore({ [name]: 'v' });
    const session = fakeStore();
    const runtime = collect(
      fakeWindow(
        () => local.store,
        () => session.store,
      ).win,
    );
    expect(runtime.storage?.local).toEqual(['[redacted]']);
    const text = JSON.stringify(redact(Payload.parse(markWith(runtime))));
    expect(text).not.toContain('eyJzdWIi');
    expect(text).not.toContain('eyJhbGci');
  });
});
