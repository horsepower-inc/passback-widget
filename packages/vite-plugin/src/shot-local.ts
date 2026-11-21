// Local-mode screenshots (agent mode, `vite serve`): serves the shot chunk and takes the picture
// the widget uploads, keeping it in memory until the mark that names it arrives (shot-inbox.ts).

import { randomBytes } from 'node:crypto';
import type { Connect } from 'vite';
import { readWidgetFile } from './widget-artifact';

export const MAX_SHOT_BYTES = 2097152;
const MAX_STASH_ENTRIES = 20;
const PNG_MIME = 'image/png';
const JS_CONTENT_TYPE = 'text/javascript';

export type ShotStash = {
  put(bytes: Buffer): string;
  peek(id: string): Buffer | undefined;
  take(id: string): Buffer | undefined;
};

/** An in-memory stash of uploaded pictures by random 32 hex id; the oldest entry is dropped
 * past 20. */
export function createShotStash(): ShotStash {
  const entries = new Map<string, Buffer>();
  return {
    put(bytes) {
      const id = randomBytes(16).toString('hex');
      entries.set(id, bytes);
      while (entries.size > MAX_STASH_ENTRIES) entries.delete(entries.keys().next().value!);
      return id;
    },
    peek(id) {
      return entries.get(id);
    },
    take(id) {
      const bytes = entries.get(id);
      entries.delete(id);
      return bytes;
    },
  };
}

/** Reads the shot chunk as raw bytes. Every call re-reads from disk. */
export function readShotArtifact(): { path: string; bytes: Buffer } {
  return readWidgetFile('passback-shot.js');
}

/** The dev-only chunk URL, beside the widget at `${base}@passback/widget.js`. */
export function shotChunkSrc(base: string): string {
  return `${base}@passback/shot.js`;
}

/** The same-origin upload route named by `data-passback-shot-upload`. */
export function shotUploadUrl(base: string): string {
  return `${base}@passback/screenshots`;
}

/** Serves the shot chunk bytes at {@link shotChunkSrc} for GET/HEAD; everything else calls `next()`. */
export function createShotChunkMiddleware(
  base: string,
  bytes: Uint8Array,
): Connect.NextHandleFunction {
  const endpoint = shotChunkSrc(base);
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

/** Takes a POSTed `image/png` body (at most 2 MiB) into the stash and answers 201 `{"id"}`;
 * everything else calls `next()`. */
export function createShotUploadMiddleware(
  base: string,
  stash: ShotStash,
): Connect.NextHandleFunction {
  const endpoint = shotUploadUrl(base);
  return (req, res, next) => {
    const pathname = (req.url ?? '').split('?')[0];
    if (pathname !== endpoint || req.method !== 'POST') {
      next();
      return;
    }
    const reply = (status: number, body = ''): void => {
      res.statusCode = status;
      if (status === 201) res.setHeader('Content-Type', 'application/json');
      res.setHeader('Connection', 'close');
      res.end(body);
    };
    if (req.headers['content-type'] !== PNG_MIME) {
      reply(415);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const onData = (chunk: Buffer): void => {
      size += chunk.byteLength;
      if (size > MAX_SHOT_BYTES) {
        done = true;
        req.off('data', onData);
        req.pause();
        reply(413);
        return;
      }
      chunks.push(chunk);
    };
    req.on('data', onData);
    req.on('end', () => {
      if (done) return;
      done = true;
      reply(201, JSON.stringify({ id: stash.put(Buffer.concat(chunks)) }));
    });
    req.on('error', () => {
      if (done) return;
      done = true;
      reply(400);
    });
  };
}

/** Mounts the chunk and upload routes; reads the chunk file here, so an install without a built
 * shot chunk fails with the build guidance. */
export function serveShotRoutes(
  app: { use(handler: Connect.NextHandleFunction): unknown },
  base: string,
  stash: ShotStash,
): void {
  app.use(createShotChunkMiddleware(base, readShotArtifact().bytes));
  app.use(createShotUploadMiddleware(base, stash));
}

type ShotState = {
  base: string;
  command: 'build' | 'serve';
  endpoint: string | undefined;
  agentShots: boolean;
};

/** One warning from an agent-mode build: pictures there need the dev server. */
export function warnAgentBuildShots(state: ShotState, warn: (message: string) => void): void {
  if (!state.agentShots || state.command !== 'build') return;
  warn('passback: screenshots in agent mode need the dev server (vite serve)');
}

/** The widget tag attributes for the `screenshots` option; the upload url only on the agent serve tag. */
export function shotAttrs(
  state: ShotState,
  screenshots: boolean | undefined,
  settingAttrs: Record<string, string>,
): Record<string, string> {
  if (!(screenshots ?? state.endpoint !== undefined)) return settingAttrs;
  const attrs = { ...settingAttrs, 'data-passback-screenshots': 'true' };
  if (!state.agentShots || state.command !== 'serve') return attrs;
  return { ...attrs, 'data-passback-shot-upload': shotUploadUrl(state.base) };
}
