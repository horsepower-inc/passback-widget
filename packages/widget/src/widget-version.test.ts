// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import type { ChannelMark, Payload } from '@passback/schema';
import type { Hot } from './channel';
import { collect } from './collect';
import type { Collector, CollectFactory } from './collect';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const run = promisify(execFile);

// The happy-dom environment breaks file URLs, so the build script runs in a plain Node child process.
type Env = Record<string, string>;
const CHILD = `
import { build } from 'esbuild';
const m = await import(process.argv[1]);
const { env, entry } = JSON.parse(process.argv[2]);
const out = { version: m.buildStamp(env).version, banners: [], text: '' };
for (const b of m.BUNDLES) {
  const r = await build({ ...m.buildOptions(b, env), write: false });
  const text = r.outputFiles[0].text;
  out.banners.push({ outfile: b.outfile, head: text.slice(0, 120) });
  if (b.entry === entry) out.text = text;
}
process.stdout.write(JSON.stringify(out));
`;
// Vitest runs from the repo root for a single file and from packages/widget under the package script.
const widgetDir = existsSync(`${process.cwd()}/scripts/bundles.mjs`)
  ? process.cwd()
  : `${process.cwd()}/packages/widget`;
const bundlesUrl = `file://${widgetDir}/scripts/bundles.mjs`;
const script = async (env: Env) => {
  const { stdout } = await run(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      CHILD,
      bundlesUrl,
      JSON.stringify({ env, entry: 'src/collect.ts' }),
    ],
    { cwd: widgetDir, maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(stdout) as {
    version: string;
    banners: { outfile: string; head: string }[];
    text: string;
  };
};

const SOURCE = 'dev unknown';

function fakeHot(sent: ChannelMark[]) {
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  const hot: Hot = {
    send(_event, data) {
      const mark = data as ChannelMark;
      sent.push(mark);
      for (const cb of handlers.get('passback:ack') ?? []) {
        cb({
          v: 1,
          batchId: mark.batch.id,
          accepted: mark.batch.marks.map(() => 'a1'),
          trimmed: [],
        });
      }
    },
    on(event, cb) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)?.add(cb);
    },
    off(event, cb) {
      handlers.get(event)?.delete(cb);
    },
  };
  return hot;
}

function stubRelay(posted: ChannelMark[], mode: 'ok' | 'reject' | 'timeout' = 'ok') {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (mode === 'reject') throw new TypeError('network down');
    if (mode === 'timeout') throw new DOMException('timed out', 'TimeoutError');
    const mark = JSON.parse(String(init?.body)) as ChannelMark;
    posted.push(mark);
    return new Response(
      JSON.stringify({
        v: 1,
        batchId: mark.batch.id,
        accepted: mark.batch.marks.map(() => 'r1'),
        trimmed: [],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const widgets = (marks: ChannelMark[]) =>
  marks.flatMap((m) => m.batch.marks.map((p) => p.code.widget));
const scope = window as unknown as { __passback?: Record<string, unknown> };

describe('B1 widget identity on marks', () => {
  let collector: Collector | undefined;
  let items: { el: Element; comment: string }[];
  const make = (factory: CollectFactory, opts: Parameters<CollectFactory>[0]) =>
    (collector = factory(opts));

  beforeEach(() => {
    document.body.innerHTML = '<button id="b">Save</button><a id="c">Go</a>';
    items = [
      { el: document.getElementById('b')!, comment: 'one' },
      { el: document.getElementById('c')!, comment: 'two' },
    ];
  });

  afterEach(() => {
    collector?.dispose();
    collector = undefined;
    delete scope.__passback;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('sends the artifact identity on single and batched marks to every destination', async () => {
    const onStatus = () => {};
    // HMR channel: single and batch.
    const hmr: ChannelMark[] = [];
    make(collect, { win: window, hot: fakeHot(hmr), onStatus });
    await collector!.send(items[0]!.el, 'single');
    await collector!.sendBatch!(items);
    expect(widgets(hmr)).toEqual([SOURCE, SOURCE, SOURCE]);
    expect(hmr[0]!.batch.marks[0]!.code.framework).toBeDefined();
    collector!.dispose();

    // Hosted relay, then explicit tracker routing on a page that also has a channel.
    const posted: ChannelMark[] = [];
    stubRelay(posted);
    make(collect, { win: window, endpoint: '/passback', onStatus });
    await collector!.send(items[0]!.el, 'single');
    await collector!.sendBatch!(items);
    collector!.dispose();
    const viaChannel: ChannelMark[] = [];
    make(collect, { win: window, hot: fakeHot(viaChannel), endpoint: '/passback', onStatus });
    await collector!.sendBatch!(items, { dest: 'tracker' });
    expect(widgets(posted)).toEqual([SOURCE, SOURCE, SOURCE, SOURCE, SOURCE]);
    expect(viaChannel).toEqual([]);
    collector!.dispose();

    // Review session comments.
    const reviewed: Payload[] = [];
    scope.__passback = {
      reviewRoute: async (payloads: Payload[]) => {
        reviewed.push(...payloads);
        return { ok: true, accepted: payloads.map(() => 'c'), trimmed: [] };
      },
    };
    make(collect, { win: window, endpoint: '/passback', onStatus });
    await collector!.send(items[0]!.el, 'single');
    await collector!.sendBatch!(items);
    expect(reviewed.map((p) => p.code.widget)).toEqual([SOURCE, SOURCE, SOURCE]);
  });

  it('the B1 check reads the identity of a mark emitted by collect', async () => {
    const sent: ChannelMark[] = [];
    make(collect, { win: window, hot: fakeHot(sent), onStatus: () => {} });
    await collector!.send(items[0]!.el, 'one');
    const identity = sent[0]!.batch.marks[0]!.code.widget;
    expect(identity).toMatch(/^\S+ (?:[0-9a-f]{7}|unknown)$/);
    expect(identity).toBe(SOURCE);
  });

  it('sends the identity stamped into the built collector artifact', async () => {
    const env = { PASSBACK_SHA: 'abcdef0123456789abcdef0123456789abcdef01' };
    const { version, text } = await script(env);
    const win = new Window();
    win.eval(text);
    const sent: ChannelMark[] = [];
    const built = (
      win as unknown as { __passback: { collect: CollectFactory } }
    ).__passback.collect({
      win: win as unknown as globalThis.Window & typeof globalThis,
      hot: fakeHot(sent),
      onStatus: () => {},
    });
    win.document.body.innerHTML = '<button id="b">Save</button>';
    await built.send(win.document.getElementById('b') as unknown as Element, 'hi');
    built.dispose();
    const identity = sent[0]!.batch.marks[0]!.code.widget;
    expect(identity).toBe(`${version} abcdef0`);
    expect(identity!.length).toBeLessThanOrEqual(40);
    expect(text.startsWith(`/* passback ${version} ${env.PASSBACK_SHA} */`)).toBe(true);
  });

  it('keeps widget identity stable across repeated sends and separate from the app build', async () => {
    const sent: ChannelMark[] = [];
    make(collect, { win: window, hot: fakeHot(sent), onStatus: () => {} });
    await collector!.send(items[0]!.el, 'a');
    await collector!.send(items[1]!.el, 'b');
    const [first, second] = sent.map((m) => m.batch.marks[0]!.code);
    expect(first!.widget).toBe(SOURCE);
    expect(second!.widget).toBe(first!.widget);
    expect(first!.widget).not.toBe(first!.buildId);
  });

  it('sends the local build identity when no commit is available', async () => {
    const { version, text, banners } = await script({});
    for (const { outfile, head } of banners) {
      expect(head.startsWith(`/* passback ${version} unknown */`), outfile).toBe(true);
    }
    const win = new Window();
    win.eval(text);
    const sent: ChannelMark[] = [];
    const built = (
      win as unknown as { __passback: { collect: CollectFactory } }
    ).__passback.collect({
      win: win as unknown as globalThis.Window & typeof globalThis,
      hot: fakeHot(sent),
      onStatus: () => {},
    });
    win.document.body.innerHTML = '<button id="b">Save</button>';
    await built.send(win.document.getElementById('b') as unknown as Element, 'hi');
    built.dispose();
    expect(sent[0]!.batch.marks[0]!.code.widget).toBe(`${version} unknown`);
    // Unbundled source execution.
    make(collect, { win: window, hot: fakeHot(sent), onStatus: () => {} });
    await collector!.send(items[0]!.el, 'src');
    expect(sent[1]!.batch.marks[0]!.code.widget).toBe('dev unknown');
  });

  it('falls back from unsafe stamp inputs without preventing a mark send', async () => {
    const identityOf = async (env: Env) => {
      const win = new Window();
      win.eval((await script(env)).text);
      const sent: ChannelMark[] = [];
      const built = (
        win as unknown as { __passback: { collect: CollectFactory } }
      ).__passback.collect({
        win: win as unknown as globalThis.Window & typeof globalThis,
        hot: fakeHot(sent),
        onStatus: () => {},
      });
      win.document.body.innerHTML = '<button id="b">Save</button>';
      const res = await built.send(win.document.getElementById('b') as unknown as Element, 'hi');
      built.dispose();
      expect(res.ok).toBe(true);
      return sent[0]!.batch.marks[0]!.code.widget;
    };
    const { version } = await script({});
    expect(await identityOf({ PASSBACK_SHA: 'x*/y', GITHUB_SHA: 'bbbbbbbbbb' })).toBe(
      `${version} bbbbbbb`,
    );
    expect(await identityOf({ PASSBACK_SHA: 'x*/y', GITHUB_SHA: '"; boom' })).toBe(
      `${version} unknown`,
    );
  });

  it('preserves send failures and stamps the next successful attempt', async () => {
    // Missing destination.
    make(collect, { win: window, onStatus: () => {} });
    expect(await collector!.send(items[0]!.el, 'x')).toMatchObject({
      ok: false,
      reason: 'network',
    });
    collector!.dispose();

    // Transport rejection and timeout, then success.
    for (const mode of ['reject', 'timeout'] as const) {
      stubRelay([], mode);
      make(collect, { win: window, endpoint: '/passback', onStatus: () => {} });
      expect((await collector!.send(items[0]!.el, 'x')).ok).toBe(false);
      const posted: ChannelMark[] = [];
      stubRelay(posted);
      expect((await collector!.send(items[0]!.el, 'again')).ok).toBe(true);
      expect(widgets(posted)).toEqual([SOURCE]);
      collector!.dispose();
    }
  });
});
