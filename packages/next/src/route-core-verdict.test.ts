// and POST /api/passback/verdict over a temp root.

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
  return new Request(BASE + 'verdict', { method: 'POST', headers, body });
}

const verdictBody = (verdict: string, markId = ID) => JSON.stringify({ v: 1, markId, verdict });

describe('handleRequest verdict', () => {
  let root: string;
  let deps: RouteDeps;
  const inboxFile = () => path.join(root, '.passback', 'inbox', `${ID}.md`);
  const outbox = () => path.join(root, '.passback', 'outbox');
  const outboxNames = async () => (await readdir(outbox()).catch(() => [])).sort();
  const send = (req: Request) => handleRequest(req, ['verdict'], deps);

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'passback-route-verdict-'));
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

  it('applies an accept: the mark becomes accepted and the route answers 204', async () => {
    const res = await send(post(verdictBody('accept')));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(await readFile(inboxFile(), 'utf8')).toMatch(/^status: "accepted"$/m);
    expect(await outboxNames()).toEqual([]);
  });

  it('applies withdraw, park and unpark to the inbox file and answers 204 each time', async () => {
    expect((await send(post(verdictBody('park')))).status).toBe(204);
    const parked = await readFile(inboxFile(), 'utf8');
    expect(parked).toMatch(/^parked: true$/m);
    expect(parked).toMatch(/^status: "proposed"$/m);
    expect((await send(post(verdictBody('unpark')))).status).toBe(204);
    expect(await readFile(inboxFile(), 'utf8')).not.toContain('parked');
    expect((await send(post(verdictBody('withdraw')))).status).toBe(204);
    expect(await readFile(inboxFile(), 'utf8')).toMatch(/^status: "withdrawn"$/m);
  });

  it('answers 204 and changes nothing for a verdict it cannot apply', async () => {
    const before = await readFile(inboxFile(), 'utf8');
    const absent = verdictBody('accept', '01J8Z3K4M5N6P7Q8R9S0T1V2W4');
    expect((await send(post(absent))).status).toBe(204);
    expect((await send(post(JSON.stringify({ v: 1 })))).status).toBe(204);
    expect((await send(post(verdictBody('nope')))).status).toBe(204);
    expect(await readFile(inboxFile(), 'utf8')).toBe(before);
    expect(await readdir(path.dirname(inboxFile()))).toEqual([`${ID}.md`]);
  });

  it('failure: a cross-origin verdict is refused with 403 and changes nothing', async () => {
    const before = await readFile(inboxFile(), 'utf8');
    const res = await send(
      post(verdictBody('accept'), { ...JSON_TYPE, origin: 'http://evil.example' }),
    );
    expect(res.status).toBe(403);
    expect(await readFile(inboxFile(), 'utf8')).toBe(before);
  });

  it('answers 400 for a body that is not JSON', async () => {
    const res = await send(post('{nope'));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('');
  });

  it('answers 405 for a GET of the verdict route', async () => {
    const res = await send(new Request(BASE + 'verdict'));
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });
});
