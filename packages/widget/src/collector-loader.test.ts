// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { loadCollectFactory, readScriptConfig } from './collector-loader';

type Win = Window & { __passback?: { collect?: unknown } };

function setup(attrs: Record<string, string> = {}) {
  const doc = document.implementation.createHTMLDocument('');
  if (Object.keys(attrs).length > 0) {
    const tag = doc.createElement('script');
    for (const [k, v] of Object.entries(attrs)) tag.setAttribute(k, v);
    doc.head.append(tag);
  }
  const added: HTMLScriptElement[] = [];
  vi.spyOn(doc.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
    added.push(node as unknown as HTMLScriptElement);
    return node;
  });
  const win = {} as Win;
  return { doc, win, added };
}

describe('collector-loader', () => {
  it('reads the chunk url and the endpoint from the widget script', () => {
    const { doc } = setup({ 'data-passback-chunk': '/c.js', 'data-passback-endpoint': '/e' });
    expect(readScriptConfig(doc)).toEqual({ chunkSrc: '/c.js', endpoint: '/e' });
    const empty = setup({ 'data-passback-chunk': '', 'data-passback-endpoint': '/e' });
    expect(readScriptConfig(empty.doc)).toEqual({ endpoint: '/e' });
  });

  it('resolves the registered factory without adding a script', async () => {
    const { doc, win, added } = setup({ 'data-passback-chunk': '/c.js' });
    const factory = vi.fn();
    win.__passback = { collect: factory };
    await expect(loadCollectFactory(doc, win)).resolves.toBe(factory);
    expect(added).toHaveLength(0);
  });

  it('adds one script for the chunk and resolves when it registers the factory', async () => {
    const { doc, win, added } = setup({ 'data-passback-chunk': '/c.js' });
    const p = loadCollectFactory(doc, win);
    expect(added).toHaveLength(1);
    expect(added[0]?.getAttribute('src')).toBe('/c.js');
    expect(added[0]?.async).toBe(true);
    const factory = vi.fn();
    win.__passback = { collect: factory };
    added[0]?.dispatchEvent(new Event('load'));
    await expect(p).resolves.toBe(factory);
  });

  it('shares one load between two callers', async () => {
    const { doc, win, added } = setup({ 'data-passback-chunk': '/c.js' });
    const a = loadCollectFactory(doc, win);
    const b = loadCollectFactory(doc, win);
    expect(b).toBe(a);
    expect(added).toHaveLength(1);
    const factory = vi.fn();
    win.__passback = { collect: factory };
    added[0]?.dispatchEvent(new Event('load'));
    expect(await a).toBe(factory);
  });

  it('rejects when the widget script names no chunk', async () => {
    const { doc, win, added } = setup();
    await expect(loadCollectFactory(doc, win)).rejects.toThrow(
      'passback: the widget script has no data-passback-chunk',
    );
    expect(added).toHaveLength(0);
  });

  it('rejects when the chunk loads but registers nothing', async () => {
    const { doc, win, added } = setup({ 'data-passback-chunk': '/c.js' });
    const p = loadCollectFactory(doc, win);
    added[0]?.dispatchEvent(new Event('load'));
    await expect(p).rejects.toThrow('passback: the collector chunk loaded but registered nothing');
  });

  it('rejects on a script error and loads again on the next call', async () => {
    const { doc, win, added } = setup({ 'data-passback-chunk': '/c.js' });
    const p = loadCollectFactory(doc, win);
    added[0]?.dispatchEvent(new Event('error'));
    await expect(p).rejects.toThrow('passback: cannot load the collector chunk (/c.js)');
    const again = loadCollectFactory(doc, win);
    expect(added).toHaveLength(2);
    const factory = vi.fn();
    win.__passback = { collect: factory };
    added[1]?.dispatchEvent(new Event('load'));
    await expect(again).resolves.toBe(factory);
  });

  it('derives the chunk url from the src of a script tag that names no chunk', () => {
    const { doc } = setup({
      type: 'text/plain',
      src: 'https://cdn.example/v2/widget.js?x=1',
      'data-passback-endpoint': 'https://api.example/v1/ingest/pb_k',
    });
    expect(readScriptConfig(doc)).toEqual({
      chunkSrc: 'https://cdn.example/v2/collector.js',
      endpoint: 'https://api.example/v1/ingest/pb_k',
    });
  });

  it('keeps the named chunk when the tag also has a src', () => {
    const { doc } = setup({
      type: 'text/plain',
      src: 'https://cdn.example/widget.js',
      'data-passback-chunk': '/c.js',
    });
    expect(readScriptConfig(doc).chunkSrc).toBe('/c.js');
  });

  it('loads the derived chunk for a pasted snippet and resolves the registered factory', async () => {
    const { doc, win, added } = setup({
      type: 'text/plain',
      src: 'https://cdn.example/widget.js',
      'data-passback-endpoint': '/e',
    });
    const p = loadCollectFactory(doc, win);
    expect(added).toHaveLength(1);
    expect(added[0]?.getAttribute('src')).toBe('https://cdn.example/collector.js');
    const factory = vi.fn();
    win.__passback = { collect: factory };
    added[0]?.dispatchEvent(new Event('load'));
    await expect(p).resolves.toBe(factory);
  });

  it('still rejects when the tag names no chunk and has no src', async () => {
    const { doc, win, added } = setup({ 'data-passback-endpoint': '/e' });
    await expect(loadCollectFactory(doc, win)).rejects.toThrow(
      'passback: the widget script has no data-passback-chunk',
    );
    expect(added).toHaveLength(0);
  });
});
