// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { loadShotOpen, readShotConfig } from './shot-loader';

type Win = Window & { __passback?: { shot?: unknown } };
const attrs = {
  'data-passback-screenshots': 'true',
  'data-passback-endpoint': 'https://relay.example/v1/ingest/site-1',
  'data-passback-shot': '/passback-shot.js',
};

function setup(settings: Record<string, string> = attrs) {
  const doc = document.implementation.createHTMLDocument('');
  const tag = doc.createElement('script');
  for (const [key, value] of Object.entries(settings)) tag.setAttribute(key, value);
  doc.head.append(tag);
  const added: HTMLScriptElement[] = [];
  vi.spyOn(doc.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
    added.push(node as unknown as HTMLScriptElement);
    return node;
  });
  return { doc, win: {} as Win, added };
}

describe('shot-loader', () => {
  it('is enabled only when one script tag has the endpoint, the shot chunk and screenshots true', () => {
    expect(readShotConfig(setup().doc)).toEqual({
      enabled: true, src: '/passback-shot.js',
      uploadUrl: 'https://relay.example/v1/ingest/site-1/screenshots',
    });
    const { doc } = setup({ 'data-passback-screenshots': 'true', 'data-passback-endpoint': '/e' });
    const other = doc.createElement('script');
    other.setAttribute('data-passback-shot', '/s.js');
    doc.body.append(other);
    expect(readShotConfig(doc)).toEqual({ enabled: false });
    expect(readShotConfig(setup({ ...attrs, 'data-passback-shot': '' }).doc)).toEqual({ enabled: false });
    Object.entries(attrs).forEach(([key, value]) => other.setAttribute(key, value));
    expect(readShotConfig(doc).enabled).toBe(true);
  });

  it('is disabled when data-passback-screenshots is not true', async () => {
    for (const value of ['', 'false', 'TRUE']) {
      const { doc, win, added } = setup({ ...attrs, 'data-passback-screenshots': value });
      expect(readShotConfig(doc)).toEqual({ enabled: false });
      await expect(loadShotOpen(doc, win)).rejects.toThrow(/^passback: /);
      expect(added).toHaveLength(0);
    }
    expect(readShotConfig(setup({ 'data-passback-endpoint': '/e', 'data-passback-shot': '/s' }).doc))
      .toEqual({ enabled: false });
  });

  it('is disabled when there is no endpoint', () => {
    expect(readShotConfig(setup({ 'data-passback-screenshots': 'true', 'data-passback-shot': '/s' }).doc))
      .toEqual({ enabled: false });
    expect(readShotConfig(setup({ ...attrs, 'data-passback-endpoint': '' }).doc)).toEqual({ enabled: false });
  });

  it('derives the upload url from the endpoint without a trailing slash', () => {
    for (const suffix of ['', '/', '///']) {
      expect(readShotConfig(setup({ ...attrs, 'data-passback-endpoint': `/e${suffix}` }).doc))
        .toEqual({ enabled: true, src: '/passback-shot.js', uploadUrl: '/e/screenshots' });
    }
  });

  it('derives the shot chunk url from the src of a script tag that opts in but names no chunk', () => {
    const optIn = {
      type: 'text/plain',
      src: 'https://cdn.example/v2/widget.js',
      'data-passback-screenshots': 'true',
      'data-passback-endpoint': 'https://api.example/v1/ingest/pb_k',
    };
    expect(readShotConfig(setup(optIn).doc)).toEqual({
      enabled: true, src: 'https://cdn.example/v2/shot.js',
      uploadUrl: 'https://api.example/v1/ingest/pb_k/screenshots',
    });
  });

  it('keeps a named shot chunk when the tag also has a src', () => {
    const named = {
      type: 'text/plain',
      src: 'https://cdn.example/v2/widget.js',
      'data-passback-screenshots': 'true',
      'data-passback-endpoint': 'https://api.example/v1/ingest/pb_k',
      'data-passback-shot': '/s.js',
    };
    expect(readShotConfig(setup(named).doc)).toEqual({
      enabled: true, src: '/s.js',
      uploadUrl: 'https://api.example/v1/ingest/pb_k/screenshots',
    });
  });

  it('stays disabled for a tag with a src that does not opt in to screenshots', () => {
    const quiet = {
      type: 'text/plain',
      src: 'https://cdn.example/v2/widget.js',
      'data-passback-endpoint': 'https://api.example/v1/ingest/pb_k',
    };
    expect(readShotConfig(setup(quiet).doc)).toEqual({ enabled: false });
  });

  it('local: reads the upload url from data-passback-shot-upload when there is no endpoint', () => {
    const local = {
      type: 'text/plain',
      src: 'http://localhost:5173/@passback/widget.js',
      'data-passback-screenshots': 'true',
      'data-passback-shot-upload': '/__passback/screenshot',
    };
    expect(readShotConfig(setup(local).doc)).toEqual({
      enabled: true, src: 'http://localhost:5173/@passback/shot.js',
      uploadUrl: '/__passback/screenshot', local: true,
    });
    expect(readShotConfig(setup({ ...local, 'data-passback-shot': '/s.js' }).doc)).toEqual({
      enabled: true, src: '/s.js', uploadUrl: '/__passback/screenshot', local: true,
    });
    expect(readShotConfig(setup({ ...local, 'data-passback-shot-upload': '' }).doc))
      .toEqual({ enabled: false });
    expect(readShotConfig(setup({ ...local, 'data-passback-screenshots': 'false' }).doc))
      .toEqual({ enabled: false });
  });

  it('local: the endpoint wins over data-passback-shot-upload', () => {
    const both = { ...attrs, 'data-passback-shot-upload': '/__passback/screenshot' };
    expect(readShotConfig(setup(both).doc)).toEqual({
      enabled: true, src: '/passback-shot.js',
      uploadUrl: 'https://relay.example/v1/ingest/site-1/screenshots',
    });
  });

  it('loads the chunk once and resolves the registered function', async () => {
    const { doc, win, added } = setup();
    const pending = loadShotOpen(doc, win);
    expect(loadShotOpen(doc, win)).toBe(pending);
    expect(added).toHaveLength(1);
    expect(added[0]?.getAttribute('src')).toBe('/passback-shot.js');
    expect(added[0]?.async).toBe(true);
    const open = vi.fn();
    win.__passback = { shot: open };
    added[0]?.dispatchEvent(new Event('load'));
    await expect(pending).resolves.toBe(open);
    await expect(loadShotOpen(doc, win)).resolves.toBe(open);
    expect(added).toHaveLength(1);
    const ready = setup({});
    ready.win.__passback = { shot: open };
    await expect(loadShotOpen(ready.doc, ready.win)).resolves.toBe(open);
    expect(ready.added).toHaveLength(0);
  });

  it('rejects when the chunk loads but registers nothing', async () => {
    const { doc, win, added } = setup();
    win.__passback = { shot: {} };
    const pending = loadShotOpen(doc, win);
    added[0]?.dispatchEvent(new Event('load'));
    await expect(pending).rejects.toThrow('passback: the shot chunk loaded but registered nothing');
    const again = loadShotOpen(doc, win);
    expect(added).toHaveLength(2);
    win.__passback.shot = vi.fn();
    added[1]?.dispatchEvent(new Event('load'));
    await expect(again).resolves.toBe(win.__passback.shot);
  });

  it('rejects when the chunk cannot be loaded and tries again next time', async () => {
    const { doc, win, added } = setup();
    const pending = loadShotOpen(doc, win);
    added[0]?.dispatchEvent(new Event('error'));
    await expect(pending).rejects.toThrow('passback: cannot load the shot chunk (/passback-shot.js)');
    const again = loadShotOpen(doc, win);
    expect(added).toHaveLength(2);
    const open = vi.fn();
    win.__passback = { shot: open };
    added[1]?.dispatchEvent(new Event('load'));
    await expect(again).resolves.toBe(open);
  });
});
