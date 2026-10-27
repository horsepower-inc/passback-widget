// and POST /api/passback/list over a temp root.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listInbox = vi.hoisted(() => vi.fn());
vi.mock('@passback/adapters/local', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@passback/adapters/local')>();
  listInbox.mockImplementation(actual.listInbox);
  return { ...actual, listInbox };
});

import { handleRequest } from './route-core';
import type { RouteDeps } from './route-core';
import { getStatusHub } from './status-stream';

const ID = '01J8Z3K4M5N6P7Q8R9S0T1V2W3';
const BASE = 'http://localhost:3003/api/passback/';
const JSON_TYPE = { 'content-type': 'application/json' };

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
].join('\n');

function post(route: string, body: string, headers: Record<string, string> = JSON_TYPE) {
  return new Request(BASE + route, { method: 'POST', headers, body });
}

describe('handleRequest list', () => {
  let root: string;
  let deps: RouteDeps;
  const send = (req: Request, route = 'list') => handleRequest(req, [route], deps);

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'passback-route-list-'));
    deps = {
      root,
      assets: () => ({
        widget: Buffer.from(''),
        collector: Buffer.from(''),
        shot: Buffer.from(''),
      }),
    };
    await mkdir(path.join(root, '.passback', 'inbox'), { recursive: true });
    await writeFile(path.join(root, '.passback', 'inbox', `${ID}.md`), proposed);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it('answers POST list with the rows and truncated', async () => {
    const res = await send(post('list', JSON.stringify({ v: 1 })));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      v: number;
      items: Array<{ id: string }>;
      truncated: boolean;
      agent: unknown;
    };
    expect(body.v).toBe(1);
    expect(body.truncated).toBe(false);
    expect(body.agent).toEqual({ state: 'absent' });
    expect(body.items.map((i) => i.id)).toEqual([ID]);
  });

  it('answers 400 to a list body that is not a ChannelList', async () => {
    listInbox.mockClear();
    for (const body of ['{nope', JSON.stringify({ v: 2 }), JSON.stringify([])]) {
      const res = await send(post('list', body));
      expect(res.status).toBe(400);
      expect(await res.text()).toBe('');
    }
    expect(listInbox).not.toHaveBeenCalled();
  });

  it('refuses a cross-origin list post and a get of list', async () => {
    listInbox.mockClear();
    const cross = await send(
      post('list', JSON.stringify({ v: 1 }), { ...JSON_TYPE, origin: 'http://evil.example' }),
    );
    expect(cross.status).toBe(403);
    const get = await send(new Request(BASE + 'list'));
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    expect(listInbox).not.toHaveBeenCalled();
  });

  it('answers 500 and no snapshot when the list rejects', async () => {
    listInbox.mockRejectedValueOnce(new Error('disk'));
    const res = await send(post('list', JSON.stringify({ v: 1 })));
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('');
  });

  it('schedules a snapshot push after a mark, an orphaned and a reopen post', async () => {
    const schedule = vi.spyOn(getStatusHub(root), 'scheduleItems');
    const mark = { v: 1, batch: { id: ID, marks: [] } };
    await send(post('mark', JSON.stringify(mark)), 'mark');
    expect(schedule).toHaveBeenCalledTimes(1);
    await send(post('orphaned', JSON.stringify({ v: 1, markIds: [ID] })), 'orphaned');
    expect(schedule).toHaveBeenCalledTimes(2);
    await send(post('reopen', JSON.stringify({ v: 1, markId: ID, comment: 'x' })), 'reopen');
    expect(schedule).toHaveBeenCalledTimes(3);
  });
});
