import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import {
  createChunkMiddleware,
  readChunkArtifact,
  serveChunkSrc,
  withChunkSrc,
} from './widget-chunk';

const MISSING_ERROR =
  /passback: cannot find the widget artifact \(@passback\/widget\/dist\/passback-collect\.js\)\. Run `pnpm --filter @passback\/widget build`/;

function fakeRequest(url: string, method: string): IncomingMessage {
  return { url, method } as IncomingMessage;
}

function fakeResponse(): ServerResponse & { headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  return {
    statusCode: 0,
    headers,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    end: vi.fn(),
  } as unknown as ServerResponse & { headers: Record<string, string> };
}

describe('widget-chunk', () => {
  it('resolves the chunk artifact from the plugin package', () => {
    const artifact = readChunkArtifact();
    expect(artifact.path.replace(/\\/g, '/')).toMatch(
      /packages\/widget\/dist\/passback-collect\.js$/,
    );
    expect(artifact.bytes.byteLength).toBeGreaterThan(0);
  });

  it('reports a missing chunk artifact with build guidance', async () => {
    vi.resetModules();
    vi.doMock('node:module', () => ({
      createRequire: () => ({
        resolve: () => {
          throw Object.assign(
            new Error("Cannot find module '@passback/widget/dist/passback-collect.js'"),
            { code: 'MODULE_NOT_FOUND' },
          );
        },
      }),
    }));
    try {
      const { readChunkArtifact: reload } = await import('./widget-chunk');
      expect(() => reload()).toThrowError(MISSING_ERROR);
    } finally {
      vi.doUnmock('node:module');
      vi.resetModules();
    }
  });

  it('serves the chunk bytes at the collector endpoint for GET and HEAD', () => {
    const middleware = createChunkMiddleware('/', Buffer.from('chunk'));
    const next = vi.fn();

    const get = fakeResponse();
    middleware(fakeRequest('/@passback/collector.js?t=1', 'GET'), get, next);
    expect(get.statusCode).toBe(200);
    expect(get.headers['Content-Type']).toBe('text/javascript');
    expect(get.headers['Content-Length']).toBe('5');
    expect(get.end).toHaveBeenCalledWith(Buffer.from('chunk'));

    const head = fakeResponse();
    middleware(fakeRequest('/@passback/collector.js', 'HEAD'), head, next);
    expect(head.headers['Content-Length']).toBe('5');
    expect(head.end).toHaveBeenCalledWith(undefined);
    expect(next).not.toHaveBeenCalled();
  });

  it('leaves other paths and other methods to next', () => {
    const middleware = createChunkMiddleware('/', Buffer.from('chunk'));
    const next = vi.fn();

    middleware(fakeRequest('/other.js', 'GET'), fakeResponse(), next);
    expect(next).toHaveBeenCalledTimes(1);

    middleware(fakeRequest('/@passback/collector.js', 'POST'), fakeResponse(), next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('adds data-passback-chunk to a tag and keeps its other attributes', () => {
    const tag = withChunkSrc(
      { tag: 'script', attrs: { type: 'module', src: '/w.js' }, injectTo: 'head-prepend' },
      '/c.js',
    );
    expect(tag).toEqual({
      tag: 'script',
      attrs: { type: 'module', src: '/w.js', 'data-passback-chunk': '/c.js' },
      injectTo: 'head-prepend',
    });
  });

  it('names the serve endpoint under the configured base', () => {
    expect(serveChunkSrc('/')).toBe('/@passback/collector.js');
    expect(serveChunkSrc('/app/')).toBe('/app/@passback/collector.js');
  });
});
