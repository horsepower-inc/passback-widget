// and POST /api/passback/clear over a temp root.

import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleRequest } from './route-core';
import type { RouteDeps } from './route-core';

const ACCEPTED_ID = '01J8Z3K4M5N6P7Q8R9S0T1V2W3';
const PROPOSED_ID = '01J8Z3K4M5N6P7Q8R9S0T1V2W4';
const BASE = 'http://localhost:3003/api/passback/';
const JSON_TYPE = { 'content-type': 'application/json' };

// The text `render` from @passback/inbox gives a mark; @passback/next does not depend on
// @passback/inbox, so the file is spelled out.
function markFile(id: string, status: string): string {
  return [
    '---',
    `id: "${id}"`,
    'schemaVersion: 1',
    `batchId: "${id}"`,
    'category: "visual"',
    `status: "${status}"`,
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
}

function post(body: string, headers: Record<string, string> = JSON_TYPE) {
  return new Request(BASE + 'clear', { method: 'POST', headers, body });
}

describe('handleRequest clear', () => {
  let root: string;
  let deps: RouteDeps;
  const inbox = () => path.join(root, '.passback', 'inbox');
  const inboxNames = async () => (await readdir(inbox())).sort();
  const send = (req: Request) => handleRequest(req, ['clear'], deps);

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'passback-route-clear-'));
    deps = {
      root,
      assets: () => ({
        widget: Buffer.from(''),
        collector: Buffer.from(''),
        shot: Buffer.from(''),
      }),
    };
    await mkdir(inbox(), { recursive: true });
    await writeFile(path.join(inbox(), `${ACCEPTED_ID}.md`), markFile(ACCEPTED_ID, 'accepted'));
    await writeFile(path.join(inbox(), `${PROPOSED_ID}.md`), markFile(PROPOSED_ID, 'proposed'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('answers a fixed-scope clear with the counts and removes the accepted comment', async () => {
    const res = await send(post(JSON.stringify({ v: 1, scope: 'fixed' })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      v: 1,
      scope: 'fixed',
      comments: 1,
      attachments: 0,
      answers: 0,
      done: 0,
      settings: false,
    });
    expect(await inboxNames()).toEqual([`${PROPOSED_ID}.md`]);
  });

  it('answers 400 for invalid JSON and for settings on a scope other than workspace', async () => {
    const notJson = await send(post('{nope'));
    expect(notJson.status).toBe(400);
    expect(await notJson.text()).toBe('');
    const settings = await send(post(JSON.stringify({ v: 1, scope: 'fixed', settings: true })));
    expect(settings.status).toBe(400);
    expect(await settings.text()).toBe('');
    expect(await inboxNames()).toHaveLength(2);
  });

  it('refuses a cross-origin request, a wrong content type and a GET', async () => {
    const body = JSON.stringify({ v: 1, scope: 'workspace' });
    const cross = await send(post(body, { ...JSON_TYPE, origin: 'http://evil.example' }));
    expect(cross.status).toBe(403);
    const wrongType = await send(post(body, { 'content-type': 'text/plain' }));
    expect(wrongType.status).toBe(415);
    const get = await send(new Request(BASE + 'clear'));
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    expect(await inboxNames()).toHaveLength(2);
  });
});
