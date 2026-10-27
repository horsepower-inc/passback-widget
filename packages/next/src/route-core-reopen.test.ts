// and POST /api/passback/reopen over a temp root.

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleRequest } from './route-core';
import type { RouteDeps } from './route-core';

const ID = '01J8Z3K4M5N6P7Q8R9S0T1V2W3';
const BASE = 'http://localhost:3003/api/passback/';
const JSON_TYPE = { 'content-type': 'application/json' };

// The text `render` from @passback/inbox gives a proposed mark with one agent reply; @passback/next
// does not depend on @passback/inbox, so the file is spelled out.
const proposed = [
  '---',
  `id: "${ID}"`,
  'schemaVersion: 1',
  `batchId: "${ID}"`,
  'category: "visual"',
  'status: "proposed"',
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
  '## Iteration 1',
  '',
  '**agent** 2026-09-19T14:05:00Z fixed the padding',
  '',
].join('\n');

function post(body: string, headers: Record<string, string> = JSON_TYPE) {
  return new Request(BASE + 'reopen', { method: 'POST', headers, body });
}

const reopenBody = JSON.stringify({ v: 1, markId: ID, comment: 'still wrong' });

describe('handleRequest reopen', () => {
  let root: string;
  let deps: RouteDeps;
  const inboxFile = () => path.join(root, '.passback', 'inbox', `${ID}.md`);
  const outbox = () => path.join(root, '.passback', 'outbox');
  const outboxNames = async () => (await readdir(outbox()).catch(() => [])).sort();
  const send = (req: Request) => handleRequest(req, ['reopen'], deps);

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'passback-route-reopen-'));
    deps = {
      root,
      assets: () => ({
        widget: Buffer.from(''),
        collector: Buffer.from(''),
        shot: Buffer.from(''),
      }),
    };
    await mkdir(path.dirname(inboxFile()), { recursive: true });
    await writeFile(inboxFile(), proposed);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('applies a reopen: next iteration in the inbox file, status ack, answers 204', async () => {
    const res = await send(post(reopenBody));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    const after = await readFile(inboxFile(), 'utf8');
    expect(after).toMatch(/^status: "ack"$/m);
    expect(after).toMatch(/^iteration: 2$/m);
    expect(after).toContain('still wrong');
    const names = await outboxNames();
    expect(names).toHaveLength(1);
    expect(names[0]).toContain('-queued.json');
  });

  it('a repeat of the same reopen answers 204 and writes the queued status again', async () => {
    expect((await send(post(reopenBody))).status).toBe(204);
    const once = await readFile(inboxFile(), 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect((await send(post(reopenBody))).status).toBe(204);
    expect(await readFile(inboxFile(), 'utf8')).toBe(once);
    expect(await outboxNames()).toHaveLength(2);
  });

  it('answers 204 and changes nothing for a reopen it cannot apply', async () => {
    const before = await readFile(inboxFile(), 'utf8');
    const missing = JSON.stringify({ v: 1, markId: '01J8Z3K4M5N6P7Q8R9S0T1V2W4', comment: 'x' });
    expect((await send(post(missing))).status).toBe(204);
    expect((await send(post(JSON.stringify({ v: 1 })))).status).toBe(204);
    expect(await readFile(inboxFile(), 'utf8')).toBe(before);
    expect(await outboxNames()).toEqual([]);
  });

  it('failure: a cross-origin reopen is refused with 403 and changes nothing', async () => {
    const before = await readFile(inboxFile(), 'utf8');
    const res = await send(post(reopenBody, { ...JSON_TYPE, origin: 'http://evil.example' }));
    expect(res.status).toBe(403);
    expect(await readFile(inboxFile(), 'utf8')).toBe(before);
    expect(await outboxNames()).toEqual([]);
  });

  it('answers 400 for a body that is not JSON', async () => {
    const res = await send(post('{nope'));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('');
  });

  it('answers 405 for a GET of the reopen route', async () => {
    const res = await send(new Request(BASE + 'reopen'));
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });
});
