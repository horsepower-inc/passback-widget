import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChannelStatus } from '@passback/schema';
import { createStatusHub, eventsResponse, getStatusHub } from './status-stream';

const STATUS: ChannelStatus = {
  v: 1,
  markId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  state: 'running',
  at: '2026-10-01T12:00:00.000Z',
};

async function until(condition: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('condition not met within 5 s');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function stays(condition: () => boolean | Promise<boolean>): Promise<boolean> {
  for (let i = 0; i < 20; i += 1) {
    if (!(await condition())) return false;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return true;
}

describe('status stream', () => {
  let root: string;
  const outbox = () => path.join(root, '.passback', 'outbox');
  const files = async () => (await readdir(outbox())).filter((n) => n.endsWith('.json'));

  async function writeStatus(name: string): Promise<void> {
    await writeFile(path.join(outbox(), `${name}.tmp`), JSON.stringify(STATUS));
    await rename(path.join(outbox(), `${name}.tmp`), path.join(outbox(), name));
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'passback-status-'));
    await mkdir(outbox(), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('delivers an outbox file to a subscriber as a ChannelStatus and deletes the file', async () => {
    const hub = createStatusHub(root, { pollMs: 10 });
    const received: ChannelStatus[] = [];
    const off = hub.subscribe((e) => received.push(e));
    await writeStatus('a.json');
    await until(() => received.length === 1);
    expect(received[0]).toEqual(STATUS);
    await until(async () => (await files()).length === 0);
    off();
  });

  it('delivers the same file to every subscriber', async () => {
    const hub = createStatusHub(root, { pollMs: 10 });
    const one: ChannelStatus[] = [];
    const two: ChannelStatus[] = [];
    const offOne = hub.subscribe((e) => one.push(e));
    const offTwo = hub.subscribe((e) => two.push(e));
    await writeStatus('a.json');
    await until(() => one.length === 1 && two.length === 1);
    expect(one[0]).toEqual(two[0]);
    offOne();
    offTwo();
  });

  it('leaves files queued while nobody is subscribed and delivers them on the next subscribe', async () => {
    const hub = createStatusHub(root, { pollMs: 10 });
    await writeStatus('a.json');
    const first: ChannelStatus[] = [];
    const off = hub.subscribe((e) => first.push(e));
    await until(() => first.length === 1);
    off();
    await writeStatus('b.json');
    expect(await stays(async () => (await files()).length === 1)).toBe(true);
    const second: ChannelStatus[] = [];
    const offAgain = hub.subscribe((e) => second.push(e));
    await until(() => second.length === 1);
    await until(async () => (await files()).length === 0);
    offAgain();
  });

  it('stops the relay when the last subscriber leaves', async () => {
    const hub = createStatusHub(root, { pollMs: 10 });
    const received: ChannelStatus[] = [];
    const offOne = hub.subscribe((e) => received.push(e));
    const offTwo = hub.subscribe((e) => received.push(e));
    offOne();
    await writeStatus('a.json');
    await until(() => received.length === 1);
    offTwo();
    await until(async () => (await files()).length === 0);
    await writeStatus('b.json');
    expect(await stays(async () => (await files()).length === 1)).toBe(true);
    expect(received).toHaveLength(1);
  });

  it('writes retry first and then one data frame per event', async () => {
    const hub = createStatusHub(root, { pollMs: 10 });
    const controller = new AbortController();
    const res = eventsResponse(
      new Request('http://localhost/events', { signal: controller.signal }),
      hub,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store, no-transform');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const pump = async (): Promise<void> => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        text += decoder.decode(value);
      }
    };
    const pumping = pump();
    await until(() => text.startsWith('retry: 1000\n\n'));
    await writeStatus('a.json');
    await until(() => text.includes('data: '));
    expect(text).toBe(`retry: 1000\n\ndata: ${JSON.stringify(STATUS)}\n\n`);
    controller.abort();
    await pumping;
  });

  it('unsubscribes when the request is aborted', async () => {
    const hub = createStatusHub(root, { pollMs: 10 });
    const controller = new AbortController();
    const res = eventsResponse(
      new Request('http://localhost/events', { signal: controller.signal }),
      hub,
    );
    const reader = res.body!.getReader();
    await reader.read();
    controller.abort();
    expect((await reader.read()).done).toBe(true);
    await writeStatus('a.json');
    expect(await stays(async () => (await files()).length === 1)).toBe(true);
  });

  it('returns one hub per root from getStatusHub', () => {
    expect(getStatusHub(root)).toBe(getStatusHub(root));
    expect(getStatusHub(root)).not.toBe(getStatusHub(`${root}-other`));
  });
});
