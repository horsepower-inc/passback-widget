// and POST /api/passback/verified over a temp root.

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import { handleRequest } from './route-core';
import type { RouteDeps } from './route-core';

const ID = '01J8Z3K4M5N6P7Q8R9S0T1V2W3';
const BASE = 'http://localhost:3003/api/passback/';
const JSON_TYPE = { 'content-type': 'application/json' };

// The text `render` from @passback/inbox gives a mark; @passback/next does not depend on
// @passback/inbox, so the file is spelled out.
function inboxText(status: string): string {
  return [
    '---',
    `id: "${ID}"`,
    'schemaVersion: 1',
    `batchId: "${ID}"`,
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
    '## Iteration 1',
    '',
    '**agent** 2026-09-19T14:05:00Z fixed the padding',
    '',
  ].join('\n');
}

function post(body: string, headers: Record<string, string> = JSON_TYPE) {
  return new Request(BASE + 'verified', { method: 'POST', headers, body });
}

const verifiedBody = JSON.stringify({ v: 1, markIds: [ID] });

describe('handleRequest verified', () => {
  let root: string;
  let deps: RouteDeps;
  const inboxFile = () => path.join(root, '.passback', 'inbox', `${ID}.md`);
  const send = (req: Request) => handleRequest(req, ['verified'], deps);

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'passback-route-verified-'));
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
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  it('moves a proposed mark to verified and answers 204', async () => {
    await writeFile(inboxFile(), inboxText('proposed'));
    const res = await send(post(verifiedBody));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(await readFile(inboxFile(), 'utf8')).toMatch(/^status: "verified"$/m);
  });

  it('answers 204 and changes nothing for a mark that is not proposed', async () => {
    const text = inboxText('ack');
    await writeFile(inboxFile(), text);
    const res = await send(post(verifiedBody));
    expect(res.status).toBe(204);
    expect(await readFile(inboxFile(), 'utf8')).toBe(text);
  });

  it('answers 400 for bad JSON, 405 for a GET and 404 when the integration is inactive', async () => {
    const text = inboxText('proposed');
    await writeFile(inboxFile(), text);
    const bad = await send(post('{nope'));
    expect(bad.status).toBe(400);
    expect(await bad.text()).toBe('');
    const got = await send(new Request(BASE + 'verified'));
    expect(got.status).toBe(405);
    expect(got.headers.get('allow')).toBe('POST');
    expect(await readFile(inboxFile(), 'utf8')).toBe(text);

    vi.stubEnv('PASSBACK_MODE', '');
    vi.stubEnv('PASSBACK_ROOT', root);
    const inactive = await POST(post(verifiedBody), {
      params: Promise.resolve({ path: ['verified'] }),
    });
    expect(inactive.status).toBe(404);
    expect(await readFile(inboxFile(), 'utf8')).toBe(text);
  });
});
