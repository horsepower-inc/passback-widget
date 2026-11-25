import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { createWidgetMiddleware, readWidgetArtifact } from './widget-bundle';

const MISSING_ERROR =
  /passback: cannot find the widget artifact \(@passback\/widget\/dist\/passback\.js\)\. Run `pnpm --filter @passback\/widget build`/;
const UNREADABLE_ERROR =
  /passback: cannot read the widget artifact \(@passback\/widget\/dist\/passback\.js\)\. Run `pnpm --filter @passback\/widget build`/;
const EMPTY_ERROR =
  /passback: found an empty widget artifact \(@passback\/widget\/dist\/passback\.js\)\. Run `pnpm --filter @passback\/widget build`/;

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

describe('readWidgetArtifact', () => {
  it('resolves the local widget artifact from the plugin package', () => {
    const artifact = readWidgetArtifact('local');
    expect(artifact.path.replace(/\\/g, '/')).toMatch(
      /packages\/widget\/dist\/passback-local\.js$/,
    );
    expect(artifact.bytes.byteLength).toBeGreaterThan(0);
  });

  it('does not resolve the widget when the plugin is constructed', async () => {
    vi.resetModules();
    const readWidgetArtifactSpy = vi.fn();
    vi.doMock('./widget-bundle', () => ({
      readWidgetArtifact: readWidgetArtifactSpy,
      createWidgetMiddleware: vi.fn(),
      serveWidgetSrc: (base: string) => `${base}@passback/widget.js`,
      buildWidgetSrc: vi.fn(),
      widgetTag: vi.fn(() => ({ tag: 'script' })),
      WIDGET_ASSET_NAME: 'widget.js',
    }));
    try {
      const { passback } = await import('./plugin');
      passback();
      expect(readWidgetArtifactSpy).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock('./widget-bundle');
      vi.resetModules();
    }
  });

  it('reports a missing widget artifact with build guidance', async () => {
    vi.resetModules();
    vi.doMock('node:module', () => ({
      createRequire: () => ({
        resolve: () => {
          throw Object.assign(new Error("Cannot find module '@passback/widget/dist/passback.js'"), {
            code: 'MODULE_NOT_FOUND',
          });
        },
      }),
    }));
    try {
      const { readWidgetArtifact: reload } = await import('./widget-bundle');
      expect(() => reload()).toThrowError(MISSING_ERROR);
    } finally {
      vi.doUnmock('node:module');
      vi.resetModules();
    }
  });

  it('reports an unreadable widget artifact with build guidance', async () => {
    vi.resetModules();
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      return {
        ...actual,
        readFileSync: () => {
          throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
        },
      };
    });
    try {
      const { readWidgetArtifact: reload } = await import('./widget-bundle');
      expect(() => reload()).toThrowError(UNREADABLE_ERROR);
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });

  it('rejects an empty widget artifact', async () => {
    vi.resetModules();
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      return { ...actual, readFileSync: () => Buffer.alloc(0) };
    });
    try {
      const { readWidgetArtifact: reload } = await import('./widget-bundle');
      expect(() => reload()).toThrowError(EMPTY_ERROR);
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });

  it('discards artifact state between builds', async () => {
    vi.resetModules();
    let call = 0;
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      return { ...actual, readFileSync: () => Buffer.from(`build-${++call}`) };
    });
    try {
      const { readWidgetArtifact: reload } = await import('./widget-bundle');
      expect(reload().bytes.toString()).toBe('build-1');
      expect(reload().bytes.toString()).toBe('build-2');
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });
});

describe('createWidgetMiddleware', () => {
  it('passes unrelated paths and unsupported methods to next', () => {
    const middleware = createWidgetMiddleware('/', Buffer.from('widget'));
    const next = vi.fn();

    middleware(fakeRequest('/other.js', 'GET'), fakeResponse(), next);
    expect(next).toHaveBeenCalledTimes(1);

    middleware(fakeRequest('/@passback/widget.js', 'POST'), fakeResponse(), next);
    expect(next).toHaveBeenCalledTimes(2);
  });
});
