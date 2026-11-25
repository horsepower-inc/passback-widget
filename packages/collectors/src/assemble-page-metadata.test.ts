// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parsePayload, type Payload } from '@passback/schema';
import { assemblePayload } from './assemble';

type Loose = {
  __passback?: unknown;
  __NEXT_DATA__?: unknown;
  happyDOM: { setURL(u: string): void };
};
const w = window as unknown as Loose;

function mark(): Payload {
  const el = document.getElementById('el')!;
  return assemblePayload({ el, comment: 'x', win: window, timeline: [] });
}

function page(head: string): void {
  document.head.innerHTML = head;
  document.body.innerHTML = '<div id="el"></div>';
}

beforeEach(() => {
  w.happyDOM.setURL('https://app.test/dash/page?q=1');
  document.title = '';
});

afterEach(() => {
  delete w.__passback;
  delete w.__NEXT_DATA__;
  delete (document as unknown as Record<string, unknown>).title;
  document.head.innerHTML = '';
});

describe('assemblePayload page metadata', () => {
  it('captures the page title and same-origin scripts with the Next build id', () => {
    page(
      '<title>Dashboard</title><script src="/_next/a.js?v=2#frag"></script><script src="https://app.test/b.js"></script>',
    );
    w.__NEXT_DATA__ = { buildId: 'next-1' };
    w.__passback = { buildId: 'plugin-9' };

    const payload = mark();

    expect(payload.runtime.title).toBe('Dashboard');
    expect(payload.code.assets).toEqual(['/_next/a.js', '/b.js']);
    expect(payload.code.appVersion).toBe('next-1');
    expect(payload.code.buildId).toBe('plugin-9');
    expect(() => parsePayload(payload)).not.toThrow();
  });

  it('captures declared app versions on React and vanilla pages', () => {
    page('<meta name="revision" content="r4"><meta name="commit" content="c3">');
    expect(mark().code.appVersion).toBe('c3');
    page(
      '<meta name="revision" content="r4"><meta name="build" content="b2"><meta name="commit" content="c3">',
    );
    expect(mark().code.appVersion).toBe('b2');
    page(
      '<meta name="build" content="b2"><meta name="version" content=""><meta name="version" content="v1"><meta name="version" content="v1b">',
    );
    expect(mark().code.appVersion).toBe('v1');
    page('<meta name="revision" content="r4">');
    expect(mark().code.appVersion).toBe('r4');
  });

  it('bounds page metadata and excludes non-page scripts before applying the limit', () => {
    const long = '/' + 'a'.repeat(300) + '.js';
    const own = [
      '<script data-passback-chunk="/c.js" src="/own1.js"></script>',
      '<script data-passback-endpoint="/e" src="/own2.js"></script>',
      '<script>var x = 1;</script>',
      '<script src="https://cdn.test/x.js"></script>',
      '<script src="blob:https://app.test/0b5e2c1a-uuid"></script>',
      '<script src="data:text/javascript,1"></script>',
    ].join('');
    const many = Array.from({ length: 10 }, (_, i) => `<script src="s${i}.js"></script>`).join('');
    page(`${own}<script src="${long}"></script>${many}`);
    document.title = 't'.repeat(201);
    w.__NEXT_DATA__ = { buildId: 'v'.repeat(81) };

    const payload = mark();

    expect(payload.runtime.title).toBe('t'.repeat(200));
    expect(payload.code.appVersion).toBe('v'.repeat(80));
    const assets = payload.code.assets!;
    expect(assets).toHaveLength(8);
    expect(assets[0]).toBe(long.slice(0, 200));
    expect(assets.slice(1)).toEqual(Array.from({ length: 7 }, (_, i) => `/dash/s${i}.js`));
    expect(() => parsePayload(payload)).not.toThrow();

    page('<meta name="version" content="' + 'v'.repeat(80) + '">');
    document.title = 't'.repeat(200);
    const exact = mark();
    expect(exact.code.appVersion).toHaveLength(80);
    expect(exact.runtime.title).toHaveLength(200);
  });

  it('refreshes metadata on each mark and omits unavailable keys', () => {
    page('<script src="/a.js"></script><meta name="version" content="v1">');
    document.title = 'One';
    const first = mark();
    expect(first.runtime.title).toBe('One');
    expect(first.code.assets).toEqual(['/a.js']);

    page('<script src="/b.js"></script><meta name="version" content="v2">');
    document.title = 'Two';
    const html = document.documentElement.outerHTML;
    const second = mark();
    expect(second.runtime.title).toBe('Two');
    expect(second.code.assets).toEqual(['/b.js']);
    expect(second.code.appVersion).toBe('v2');
    expect(document.documentElement.outerHTML).toBe(html);

    page('<script>1</script>');
    document.title = '';
    const third = mark();
    expect('title' in third.runtime).toBe(false);
    expect('assets' in third.code).toBe(false);
    expect('appVersion' in third.code).toBe(false);
  });

  it('falls back to meta when Next metadata is malformed or unreadable', () => {
    page('<title>T</title><script src="/a.js"></script><meta name="version" content="meta-v">');
    for (const bad of [{ buildId: 42 }, { buildId: { a: 1 } }, { buildId: '' }, null, 'str']) {
      w.__NEXT_DATA__ = bad;
      const payload = mark();
      expect(payload.code.appVersion).toBe('meta-v');
      expect(payload.runtime.title).toBe('T');
      expect(payload.code.assets).toEqual(['/a.js']);
    }
    w.__NEXT_DATA__ = {
      get buildId(): string {
        throw new Error('boom');
      },
    };
    expect(mark().code.appVersion).toBe('meta-v');
  });

  it('keeps available metadata when a document metadata source fails', () => {
    page(
      '<title>T</title><script src="http://[bad"></script><script src="/ok.js"></script><meta name="version" content="v1">',
    );
    const doc = document as unknown as Record<string, unknown>;
    const boom = {
      configurable: true,
      get() {
        throw new Error('boom');
      },
    };

    expect(mark().code.assets).toEqual(['/ok.js']);

    Object.defineProperty(doc, 'title', boom);
    let payload = mark();
    expect('title' in payload.runtime).toBe(false);
    expect(payload.code.assets).toEqual(['/ok.js']);
    expect(payload.code.appVersion).toBe('v1');
    expect(() => parsePayload(payload)).not.toThrow();
    delete doc.title;

    Object.defineProperty(doc, 'scripts', boom);
    payload = mark();
    expect('assets' in payload.code).toBe(false);
    expect(payload.runtime.title).toBe('T');
    expect(payload.code.appVersion).toBe('v1');
    delete doc.scripts;

    const meta = document.querySelector('meta')!;
    meta.getAttribute = () => {
      throw new Error('boom');
    };
    payload = mark();
    expect('appVersion' in payload.code).toBe(false);
    expect(payload.runtime.title).toBe('T');
    expect(payload.code.assets).toEqual(['/ok.js']);
    delete (meta as unknown as Record<string, unknown>).getAttribute;

    page(
      '<meta name="version" content="v-bad"><meta name="version" content="v-ok"><meta name="build" content="b1">',
    );
    const first = document.querySelector('meta')!;
    const read = first.getAttribute.bind(first);
    first.getAttribute = (name: string) => {
      if (name === 'content') throw new Error('boom');
      return read(name);
    };
    expect(mark().code.appVersion).toBe('v-ok');
    delete (first as unknown as Record<string, unknown>).getAttribute;
  });
});
