// and POST /api/passback/answer over a temp root.

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleRequest } from './route-core';
import type { RouteDeps } from './route-core';

const ID = '01J8Z3K4M5N6P7Q8R9S0T1V2W3';
const OTHER = '01J8Z3K4M5N6P7Q8R9S0T1V2W4';
const BASE = 'http://localhost:3003/api/passback/';
const JSON_TYPE = { 'content-type': 'application/json' };

// A mark the agent has acknowledged; @passback/next does not depend on @passback/inbox, so the
// file is spelled out.
const acked = [
  '---',
  `id: "${ID}"`,
  'schemaVersion: 1',
  `batchId: "${ID}"`,
  'category: "visual"',
  'status: "ack"',
  'iteration: 1',
  'route: "/products/:id"',
  'selector: "[data-testid=price]"',
  'buildId: "3f2a9c1"',
  'createdAt: "2026-09-19T14:00:00Z"',
  '---',
  'looks off',
  '',
  '```json annotations',
  '[]',
  '```',
  '',
].join('\n');

function post(body: string, headers: Record<string, string> = JSON_TYPE) {
  return new Request(BASE + 'answer', { method: 'POST', headers, body });
}

const answerBody = (markId = ID) => JSON.stringify({ v: 1, markId, text: 'the blue one' });

describe('handleRequest answer', () => {
  let root: string;
  let deps: RouteDeps;
  const passback = () => path.join(root, '.passback');
  const inboxFile = () => path.join(passback(), 'inbox', `${ID}.md`);
  const send = (req: Request) => handleRequest(req, ['answer'], deps);

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'passback-route-answer-'));
    deps = {
      root,
      assets: () => ({
        widget: Buffer.from(''),
        collector: Buffer.from(''),
        shot: Buffer.from(''),
        panel: Buffer.from(''),
      }),
    };
    await mkdir(path.dirname(inboxFile()), { recursive: true });
    await writeFile(inboxFile(), acked);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('stores the answer and queues a running status', async () => {
    const res = await send(post(answerBody()));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    const stored = JSON.parse(
      await readFile(path.join(passback(), 'answers', `${ID}.json`), 'utf8'),
    );
    expect(stored).toMatchObject({ v: 1, markId: ID, text: 'the blue one' });
    const names = await readdir(path.join(passback(), 'outbox'));
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(new RegExp(`-${ID}-running\\.json$`));
  });

  it('answers 204 for a mark without an inbox file and writes nothing', async () => {
    const res = await send(post(answerBody(OTHER)));
    expect(res.status).toBe(204);
    expect(await readdir(passback())).toEqual(['inbox']);
  });

  it('answers 400 for a body that is not JSON', async () => {
    const res = await send(post('{nope'));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('');
  });

  it('refuses a GET with 405 and a cross-origin POST with 403', async () => {
    const get = await send(new Request(BASE + 'answer'));
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    const cross = await send(post(answerBody(), { ...JSON_TYPE, origin: 'http://evil.example' }));
    expect(cross.status).toBe(403);
    expect(await readdir(passback())).toEqual(['inbox']);
  });
});
