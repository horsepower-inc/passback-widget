// resolves @passback/widget's lazy collector chunk, serves it
// during `vite serve` and names it on the widget's script tag via `data-passback-chunk`.

import type { Connect, HtmlTagDescriptor } from 'vite';
import { readWidgetFile } from './widget-artifact';

export const CHUNK_ARTIFACT_SPECIFIER = '@passback/widget/dist/passback-collect.js';
export const CHUNK_ASSET_NAME = 'collector.js';

const CHUNK_ENDPOINT_NAME = '@passback/collector.js';
const JS_CONTENT_TYPE = 'text/javascript';

/** Reads the collector chunk as raw bytes, never evaluating it. Every call re-reads from disk. */
export function readChunkArtifact(): { path: string; bytes: Buffer } {
  return readWidgetFile('passback-collect.js');
}

/** The dev-only endpoint under the configured base that {@link createChunkMiddleware} serves. */
export function serveChunkSrc(base: string): string {
  return `${base}${CHUNK_ENDPOINT_NAME}`;
}

/** Serves the chunk bytes at {@link serveChunkSrc} for GET/HEAD (query string ignored);
 * everything else calls `next()`. */
export function createChunkMiddleware(
  base: string,
  bytes: Uint8Array,
): Connect.NextHandleFunction {
  const endpoint = serveChunkSrc(base);
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

/** The tag with `data-passback-chunk` added; every other attribute is kept. */
export function withChunkSrc(tag: HtmlTagDescriptor, chunkSrc: string): HtmlTagDescriptor {
  const attrs = typeof tag.attrs === 'object' ? tag.attrs : {};
  return { ...tag, attrs: { ...attrs, 'data-passback-chunk': chunkSrc } };
}
