// resolves @passback/widget's prebuilt browser bundle through
// Node package resolution and serves it during `vite serve` / an active staging build.

import type { Connect, HtmlTagDescriptor } from 'vite';
import { readWidgetFile } from './widget-artifact';

const WIDGET_ENDPOINT_NAME = '@passback/widget.js';
const JS_CONTENT_TYPE = 'text/javascript';

export const WIDGET_ASSET_NAME = 'widget.js';

export type WidgetArtifact = { path: string; bytes: Buffer };

/** Resolves `@passback/widget/dist/passback.js` (variant `'relay'`, the 20 KB build a deployed
 * site ships) or `@passback/widget/dist/passback-local.js` (variant `'local'`, the build served
 * during `vite serve`) from this package's own dependency graph and reads it as raw bytes, never
 * evaluating the bundle. Every call re-resolves and re-reads from disk: callers that need
 * build-scoped state (an emitted filename) must cache it themselves.
 * Call only from an active lifecycle hook (configureServer, generateBundle) — never eagerly. */
export function readWidgetArtifact(variant: 'relay' | 'local' = 'relay'): WidgetArtifact {
  if (variant === 'local') {
    return readWidgetFile('passback-local.js');
  }
  return readWidgetFile('passback.js');
}

function widgetEndpoint(base: string): string {
  return `${base}${WIDGET_ENDPOINT_NAME}`;
}

/** The `<script src>` used while `vite serve` is active: a stable dev-only endpoint under the
 * configured base, served by {@link createWidgetMiddleware}. */
export function serveWidgetSrc(base: string): string {
  return widgetEndpoint(base);
}

function relativePrefix(htmlPublicPath: string): string {
  const depth = htmlPublicPath.split('/').filter(Boolean).length - 1;
  return depth <= 0 ? './' : '../'.repeat(depth);
}

/** The `<script src>` for an active staging build: the Rollup-hashed asset filename, resolved
 * against the configured base — including Vite's relative-base convention, where each HTML
 * entry points back at the output root by its own nesting depth. */
export function buildWidgetSrc(base: string, htmlPublicPath: string, fileName: string): string {
  const prefix = base === './' || base === '' ? relativePrefix(htmlPublicPath) : base;
  return `${prefix}${fileName}`;
}

export function widgetTag(src: string): HtmlTagDescriptor {
  return { tag: 'script', attrs: { type: 'module', src }, injectTo: 'head-prepend' };
}

/** Serves the already-loaded widget bytes at `${base}@passback/widget.js`, matching the
 * pathname exactly (a query string is allowed) and only GET/HEAD; everything else calls
 * `next()` so Vite or the application handles it. Must be registered before Vite's own
 * middlewares (call `server.middlewares.use` directly inside `configureServer`, don't return a
 * post-hook) so it runs ahead of the HTML fallback. */
export function createWidgetMiddleware(
  base: string,
  bytes: Uint8Array,
): Connect.NextHandleFunction {
  const endpoint = widgetEndpoint(base);
  const body = Buffer.from(bytes);
  return (req, res, next) => {
    const pathname = (req.url ?? '').split('?')[0];
    const method = req.method ?? '';
    if (pathname !== endpoint || (method !== 'GET' && method !== 'HEAD')) {
      next();
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', JS_CONTENT_TYPE);
    res.setHeader('Content-Length', String(body.byteLength));
    res.end(method === 'HEAD' ? undefined : body);
  };
}
