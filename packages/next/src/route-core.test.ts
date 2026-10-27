import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parsePayload } from '@passback/schema';
import type { ChannelAck, ChannelMark } from '@passback/schema';
import { handleRequest } from './route-core';
import type { RouteDeps } from './route-core';

const BATCH_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const BASE = 'http://localhost:3003/api/passback/';
const JSON_TYPE = { 'content-type': 'application/json' };

function firstPayload() {
  const dir = fileURLToPath(new URL('../../../fixtures/payloads/', import.meta.url));
  const file = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()[0]!;
  return parsePayload(JSON.parse(readFileSync(path.join(dir, file), 'utf8')));
}

const validMark: ChannelMark = {
  v: 1,
  batch: {
    schemaVersion: 1,
    id: BATCH_ID,
    createdAt: '2026-09-19T14:00:00.000Z',
    marks: [firstPayload()],
  },
};

function post(segment: string, body: string, headers: Record<string, string> = JSON_TYPE) {
  return new Request(BASE + segment, { method: 'POST', headers, body });
}

describe('handleRequest', () => {
  let root: string;
  let deps: RouteDeps;
  const inbox = () => path.join(root, '.passback', 'inbox');

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'passback-route-'));
    deps = {
      root,
      assets: () => ({
        widget: Buffer.from('widget-bytes'),
        collector: Buffer.from('collector-bytes'),
        shot: Buffer.from('shot-bytes'),
      }),
    };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function inboxFiles(): Promise<string[]> {
    try {
      return await readdir(inbox());
    } catch {
      return [];
    }
  }

  it('serves the widget bytes at widget.js as JavaScript', async () => {
    const res = await handleRequest(new Request(BASE + 'widget.js'), ['widget.js'], deps);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toBe('widget-bytes');
  });

  it('serves the collector bytes at collector.js as JavaScript', async () => {
    const res = await handleRequest(new Request(BASE + 'collector.js'), ['collector.js'], deps);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toBe('collector-bytes');
  });

  it('serves the shot bytes at shot.js as JavaScript', async () => {
    const res = await handleRequest(new Request(BASE + 'shot.js'), ['shot.js'], deps);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toBe('shot-bytes');
  });

  it('answers 500 with the build guidance text when the assets cannot be read', async () => {
    const failing: RouteDeps = {
      root,
      assets: () => {
        throw new Error('run pnpm --filter @passback/widget build');
      },
    };
    const res = await handleRequest(new Request(BASE + 'widget.js'), ['widget.js'], failing);
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await res.text()).toContain('pnpm --filter @passback/widget build');
  });

  it('writes a posted mark to .passback/inbox and answers its ack with 200', async () => {
    const res = await handleRequest(post('mark', JSON.stringify(validMark)), ['mark'], deps);
    expect(res.status).toBe(200);
    const ack = (await res.json()) as ChannelAck;
    expect(ack.error).toBeUndefined();
    expect(ack.batchId).toBe(BATCH_ID);
    expect(ack.accepted).toHaveLength(1);
    expect(await inboxFiles()).toContain(`${ack.accepted[0]}.md`);
  });

  it('answers 400 and an error ack for a body that is not valid JSON', async () => {
    const res = await handleRequest(post('mark', '{not json'), ['mark'], deps);
    expect(res.status).toBe(400);
    const ack = (await res.json()) as ChannelAck;
    expect(ack.error?.code).toBe('bad_request');
    expect(ack.batchId).toBe('00000000000000000000000000');
    expect(ack.accepted).toEqual([]);
  });

  it('answers 400 and an error ack for JSON that is not a ChannelMark', async () => {
    const res = await handleRequest(post('mark', '{"v":1}'), ['mark'], deps);
    expect(res.status).toBe(400);
    const ack = (await res.json()) as ChannelAck;
    expect(ack.error?.code).toBe('bad_request');
    expect(ack.accepted).toEqual([]);
    expect(await inboxFiles()).toEqual([]);
  });

  it('refuses a cross-origin mark before writing anything', async () => {
    const request = post('mark', JSON.stringify(validMark), {
      ...JSON_TYPE,
      origin: 'https://evil.example',
    });
    const res = await handleRequest(request, ['mark'], deps);
    expect(res.status).toBe(403);
    expect(((await res.json()) as ChannelAck).error?.code).toBe('forbidden');
    expect(await inboxFiles()).toEqual([]);
  });

  it('flags an acked mark orphaned in its inbox file and answers 204', async () => {
    const marked = await handleRequest(post('mark', JSON.stringify(validMark)), ['mark'], deps);
    const id = ((await marked.json()) as ChannelAck).accepted[0]!;
    const file = path.join(inbox(), `${id}.md`);
    expect(await readFile(file, 'utf8')).not.toMatch(/^orphaned: true$/m);

    const body = JSON.stringify({ v: 1, markIds: [id] });
    const res = await handleRequest(post('orphaned', body), ['orphaned'], deps);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(await readFile(file, 'utf8')).toMatch(/^orphaned: true$/m);

    const again = await handleRequest(post('orphaned', body), ['orphaned'], deps);
    expect(again.status).toBe(204);
  });

  it('answers GET events with an event stream and releases it on abort', async () => {
    const controller = new AbortController();
    const request = new Request(BASE + 'events', { signal: controller.signal });
    const res = await handleRequest(request, ['events'], deps);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    const reader = res.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('retry: 1000\n\n');
    controller.abort();
    expect((await reader.read()).done).toBe(true);
    const post405 = await handleRequest(post('events', '{}'), ['events'], deps);
    expect(post405.status).toBe(405);
    expect(post405.headers.get('allow')).toBe('GET');
  });

  it('answers 405 for a wrong method and 404 for an unknown path', async () => {
    const wrongGet = await handleRequest(new Request(BASE + 'mark'), ['mark'], deps);
    expect(wrongGet.status).toBe(405);
    expect(wrongGet.headers.get('allow')).toBe('POST');
    const wrongPost = await handleRequest(post('widget.js', '{}'), ['widget.js'], deps);
    expect(wrongPost.status).toBe(405);
    expect(wrongPost.headers.get('allow')).toBe('GET');
    const unknown = await handleRequest(new Request(BASE + 'nope'), ['nope'], deps);
    expect(unknown.status).toBe(404);
  });
});
