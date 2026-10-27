import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parsePayload } from '@passback/schema';
import type { ChannelAck, ChannelMark } from '@passback/schema';
import { GET, POST } from './route';

const BATCH_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const URL_BASE = 'http://localhost:3003/api/passback/';

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

const context = { params: Promise.resolve({ path: ['mark'] }) };

describe('route', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'passback-route-entry-'));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  it('answers 404 to GET and POST when PASSBACK_MODE is unset', async () => {
    vi.stubEnv('PASSBACK_MODE', '');
    vi.stubEnv('PASSBACK_ROOT', root);
    const got = await GET(new Request(URL_BASE + 'widget.js'), context);
    expect(got.status).toBe(404);
    expect(await got.text()).toBe('');
    const posted = await POST(
      new Request(URL_BASE + 'mark', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validMark),
      }),
      context,
    );
    expect(posted.status).toBe(404);
    expect(await posted.text()).toBe('');
    await expect(readdir(path.join(root, '.passback', 'inbox'))).rejects.toThrow();
  });

  it('serves shot.js to GET outside next dev', async () => {
    vi.stubEnv('PASSBACK_MODE', '');
    vi.stubEnv('PASSBACK_ROOT', root);
    const res = await GET(new Request(URL_BASE + 'shot.js'), {
      params: Promise.resolve({ path: ['shot.js'] }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/javascript/);
  });

  it('serves widget.js and collector.js to GET outside next dev', async () => {
    vi.stubEnv('PASSBACK_MODE', '');
    vi.stubEnv('PASSBACK_ROOT', root);
    for (const file of ['widget.js', 'collector.js']) {
      const res = await GET(new Request(URL_BASE + file), {
        params: Promise.resolve({ path: [file] }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/^text\/javascript/);
    }
    const events = await GET(new Request(URL_BASE + 'events'), {
      params: Promise.resolve({ path: ['events'] }),
    });
    expect(events.status).toBe(404);
  });

  it('writes a posted mark and answers its ack when PASSBACK_MODE is set', async () => {
    vi.stubEnv('PASSBACK_MODE', 'dev');
    vi.stubEnv('PASSBACK_ROOT', root);
    const res = await POST(
      new Request(URL_BASE + 'mark', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validMark),
      }),
      context,
    );
    expect(res.status).toBe(200);
    const ack = (await res.json()) as ChannelAck;
    expect(ack.batchId).toBe(BATCH_ID);
    expect(ack.accepted).toHaveLength(1);
    expect(await readdir(path.join(root, '.passback', 'inbox'))).toContain(`${ack.accepted[0]}.md`);
  });
});
