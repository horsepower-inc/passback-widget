// resolves @passback/widget's lazy collector chunk, serves it
// during `vite serve` and names it on the widget's script tag via `data-passback-chunk`.

import type { Connect, HtmlTagDescriptor } from 'vite';
import { readWidgetFile } from './widget-artifact';

export const CHUNK_ASSET_NAME = 'collector.js';

const CHUNK_ENDPOINT_NAME = '@passback/collector.js';
const PANEL_ENDPOINT_NAME = '@passback/panel.js';
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
  endpoint: string = serveChunkSrc(base),
): Connect.NextHandleFunction {
  const body = Buffer.from(bytes);
  const length = String(body.byteLength);
  return (req, res, next) => {
    const method = req.method ?? '';
    const isRead = method === 'GET' || method === 'HEAD';
    if (!isRead || (req.url ?? '').split('?')[0] !== endpoint) {
      next();
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', JS_CONTENT_TYPE);
    res.setHeader('Content-Length', length);
    res.end(method === 'HEAD' ? undefined : body);
  };
}

/** The tag with `data-passback-chunk` (or the attribute `name`) added; every other attribute is
 * kept. */
export function withChunkSrc(
  tag: HtmlTagDescriptor,
  chunkSrc: string,
  name: string = 'data-passback-chunk',
): HtmlTagDescriptor {
  const attrs = typeof tag.attrs === 'object' ? tag.attrs : {};
  return { ...tag, attrs: { ...attrs, [name]: chunkSrc } };
}

/** Reads the Inbox panel chunk as raw bytes, never evaluating it. Local widget only. */
export function readPanelArtifact(): { path: string; bytes: Buffer } {
  return readWidgetFile('passback-panel.js');
}

/** The dev-only endpoint under the configured base that serves the panel chunk. */
export function servePanelSrc(base: string): string {
  return `${base}${PANEL_ENDPOINT_NAME}`;
}

/** The tag with the panel attribute added; every other attribute is kept. */
export function withPanelSrc(tag: HtmlTagDescriptor, panelSrc: string): HtmlTagDescriptor {
  return withChunkSrc(tag, panelSrc, 'data-passback-panel');
}
