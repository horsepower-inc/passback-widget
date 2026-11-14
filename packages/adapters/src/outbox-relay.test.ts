import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse, render, type InboxFile } from '@passback/inbox';
import type { ChannelStatus } from '@passback/schema';
import { drainOutbox, startOutboxRelay } from './outbox-relay';

const MARK_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

function statusEvent(overrides: Partial<ChannelStatus> = {}): ChannelStatus {
  return { v: 1, markId: MARK_ID, state: 'done', at: '2026-09-19T14:00:00.000Z', ...overrides };
}

async function writeJson(dir: string, name: string, content: unknown): Promise<string> {
  const file = path.join(dir, name);
  const tmp = path.join(dir, name + '.tmp');
  await writeFile(tmp, JSON.stringify(content));
  await rename(tmp, file);
  return file;
}

function inboxFile(overrides: Partial<InboxFile> = {}): InboxFile {
  return {
    id: MARK_ID,
    schemaVersion: 1,
    batchId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
    status: 'ack',
    iteration: 1,
    route: '/',
    selector: '#a',
    createdAt: '2026-09-19T13:00:00.000Z',
    comment: 'too small',
    annotations: [],
    iterations: [],
    ...overrides,
  };
}

describe('outbox-relay', () => {
  let root: string;
  let dir: string;
  let inboxFilePath: string;
  let stops: Array<() => void>;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'passback-outbox-'));
    dir = path.join(root, '.passback', 'outbox');
    await mkdir(dir, { recursive: true });
    inboxFilePath = path.join(root, '.passback', 'inbox', `${MARK_ID}.md`);
    stops = [];
  });

  afterEach(async () => {
    for (const stop of stops) stop();
    await rm(root, { recursive: true, force: true });
  });

  async function writeInbox(file: InboxFile): Promise<void> {
    await mkdir(path.dirname(inboxFilePath), { recursive: true });
    await writeFile(inboxFilePath, render(file));
  }

  describe('drainOutbox', () => {
    it('relays a valid file unchanged and removes it', async () => {
      const event = statusEvent();
      await writeJson(dir, 'a.json', event);
      const sent: ChannelStatus[] = [];

      const count = await drainOutbox(dir, (e) => sent.push(e));

      expect(count).toBe(1);
      expect(sent).toEqual([event]);
      await expect(readdir(dir)).resolves.toEqual([]);
    });

    it('relays in name order', async () => {
      await writeJson(dir, 'b.json', statusEvent({ state: 'running' }));
      await writeJson(dir, 'a.json', statusEvent({ state: 'queued' }));
      await writeJson(dir, 'c.json', statusEvent({ state: 'done' }));
      const sent: ChannelStatus[] = [];

      await drainOutbox(dir, (e) => sent.push(e));

      expect(sent.map((e) => e.state)).toEqual(['queued', 'running', 'done']);
    });

    it('moves a malformed file aside without relaying', async () => {
      const file = path.join(dir, 'bad.json');
      await writeFile(file, 'not json at all');
      const sent: ChannelStatus[] = [];
      const logged: string[] = [];

      const count = await drainOutbox(
        dir,
        (e) => sent.push(e),
        (m) => logged.push(m),
      );

      expect(count).toBe(0);
      expect(sent).toEqual([]);
      expect(logged).toHaveLength(1);
      expect(logged[0]).toContain('bad.json');
      await expect(readFile(`${file}.bad`, 'utf8')).resolves.toBe('not json at all');
      await expect(readdir(dir)).resolves.toEqual(['bad.json.bad']);
    });

    it('moves a status with a non-UTC offset aside', async () => {
      const file = await writeJson(
        dir,
        'offset.json',
        statusEvent({ at: '2026-09-19T14:00:00.000+02:00' }),
      );
      const sent: ChannelStatus[] = [];
      const logged: string[] = [];

      const count = await drainOutbox(
        dir,
        (e) => sent.push(e),
        (m) => logged.push(m),
      );

      expect(count).toBe(0);
      expect(sent).toEqual([]);
      expect(logged).toHaveLength(1);
      await expect(readdir(dir)).resolves.toEqual(['offset.json.bad']);
      await rm(file, { force: true });
    });

    it('a throwing send keeps the file', async () => {
      await writeJson(dir, 'a.json', statusEvent());
      const logged: string[] = [];

      const count = await drainOutbox(
        dir,
        () => {
          throw new Error('handler exploded');
        },
        (m) => logged.push(m),
      );

      expect(count).toBe(0);
      expect(logged).toHaveLength(1);
      await expect(readdir(dir)).resolves.toEqual(['a.json']);
    });

    it('drainOutbox leaves a file unsent and in place when shouldContinue is false', async () => {
      await writeJson(dir, 'a.json', statusEvent());
      const send = vi.fn();

      const count = await drainOutbox(dir, send, undefined, () => false);

      expect(count).toBe(0);
      expect(send).not.toHaveBeenCalled();
      await expect(readdir(dir)).resolves.toEqual(['a.json']);
    });

    it('drainOutbox stops between files when shouldContinue turns false', async () => {
      await writeJson(dir, 'a.json', statusEvent({ state: 'queued' }));
      await writeJson(dir, 'b.json', statusEvent({ state: 'done' }));
      const sent: ChannelStatus[] = [];
      let calls = 0;

      const count = await drainOutbox(
        dir,
        (e) => sent.push(e),
        undefined,
        () => {
          calls += 1;
          return calls <= 1;
        },
      );

      expect(count).toBe(1);
      expect(sent.map((e) => e.state)).toEqual(['queued']);
      await expect(readdir(dir)).resolves.toEqual(['b.json']);
    });

    it('creates a missing directory', async () => {
      const missing = path.join(dir, 'does-not-exist-yet');
      const sent: ChannelStatus[] = [];

      const count = await drainOutbox(missing, (e) => sent.push(e));

      expect(count).toBe(0);
      await expect(readdir(missing)).resolves.toEqual([]);
    });
  });

  describe('saving in the inbox file', () => {
    const running = (message: string, at = '2026-09-19T14:00:00.000Z'): ChannelStatus =>
      statusEvent({ state: 'running', message, at });

    it('saves the relayed status in the current iteration of the inbox file before the outbox file is deleted', async () => {
      await writeInbox(inboxFile());
      await writeJson(dir, 'a.json', running('on it'));
      const seen: InboxFile[] = [];

      await drainOutbox(dir, () => {
        seen.push(parse(readFileSync(inboxFilePath, 'utf8')));
      });

      const expected = [{ state: 'running', message: 'on it', at: '2026-09-19T14:00:00.000Z' }];
      expect(seen).toHaveLength(1);
      expect(seen[0]?.iterations.find((it) => it.n === 1)?.statuses).toEqual(expected);
      const saved = parse(await readFile(inboxFilePath, 'utf8'));
      expect(saved.iterations.find((it) => it.n === 1)?.statuses).toEqual(expected);
      await expect(readdir(dir)).resolves.toEqual([]);
      await expect(readdir(path.dirname(inboxFilePath))).resolves.toEqual([`${MARK_ID}.md`]);
    });

    it('keeps earlier statuses and every other field of the inbox file', async () => {
      const before = inboxFile({
        status: 'ack',
        iteration: 2,
        parked: true,
        iterations: [
          {
            n: 1,
            agent: { at: '2026-09-19T13:10:00.000Z', text: 'made it bigger' },
            human: {
              at: '2026-09-19T13:20:00.000Z',
              verdict: { kind: 'decline', reason: 'still small' },
            },
          },
        ],
      });
      await writeInbox(before);
      await writeJson(dir, 'a.json', running('first', '2026-09-19T14:00:00.000Z'));
      await writeJson(dir, 'b.json', running('second', '2026-09-19T14:01:00.000Z'));

      await drainOutbox(dir, () => {});

      const saved = parse(await readFile(inboxFilePath, 'utf8'));
      expect(saved.iterations[0]).toEqual(before.iterations[0]);
      expect(saved.iterations[1]).toEqual({
        n: 2,
        statuses: [
          { state: 'running', message: 'first', at: '2026-09-19T14:00:00.000Z' },
          { state: 'running', message: 'second', at: '2026-09-19T14:01:00.000Z' },
        ],
      });
      expect({ ...saved, iterations: [] }).toEqual({ ...before, iterations: [] });
    });

    it('does not save the same status twice when a send failed and the drain retries', async () => {
      await writeInbox(inboxFile());
      await writeJson(dir, 'a.json', running('on it'));
      let calls = 0;
      const send = (): void => {
        calls += 1;
        if (calls === 1) throw new Error('socket closed');
      };

      await drainOutbox(dir, send);
      await drainOutbox(dir, send);

      expect(calls).toBe(2);
      const saved = parse(await readFile(inboxFilePath, 'utf8'));
      expect(saved.iterations.find((it) => it.n === 1)?.statuses).toHaveLength(1);
      await expect(readdir(dir)).resolves.toEqual([]);
    });

    it('keeps the outbox file, sends nothing and logs once when the inbox file cannot be saved', async () => {
      await mkdir(path.dirname(inboxFilePath), { recursive: true });
      await writeFile(inboxFilePath, 'this is not an inbox file');
      await writeJson(dir, 'a.json', running('on it'));
      const send = vi.fn();
      const logged: string[] = [];

      await drainOutbox(dir, send, (m) => logged.push(m));

      expect(send).not.toHaveBeenCalled();
      await expect(readdir(dir)).resolves.toEqual(['a.json']);
      expect(logged).toHaveLength(1);
      expect(logged[0]).toContain('outbox: a.json: cannot save status in the inbox (');
    });

    it('relays and deletes a status whose mark has no inbox file', async () => {
      const event = running('on it');
      await writeJson(dir, 'a.json', event);
      const sent: ChannelStatus[] = [];
      const logged: string[] = [];

      await drainOutbox(
        dir,
        (e) => sent.push(e),
        (m) => logged.push(m),
      );

      expect(sent).toEqual([event]);
      expect(logged).toEqual([]);
      await expect(readdir(dir)).resolves.toEqual([]);
    });
  });

  describe('startOutboxRelay', () => {
    it('relays events already present at start', async () => {
      const event = statusEvent();
      await writeJson(dir, 'a.json', event);
      const sent: ChannelStatus[] = [];

      const stop = startOutboxRelay(dir, (e) => sent.push(e), { pollMs: 20 });
      stops.push(stop);

      await vi.waitFor(() => expect(sent).toEqual([event]), { timeout: 5_000 });
    });

    it('relays a file dropped later', async () => {
      const sent: ChannelStatus[] = [];
      const stop = startOutboxRelay(dir, (e) => sent.push(e), { pollMs: 20 });
      stops.push(stop);

      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(sent).toEqual([]);
      const event = statusEvent();
      await writeJson(dir, 'a.json', event);

      await vi.waitFor(() => expect(sent).toEqual([event]), { timeout: 5_000 });
    });

    it('stops polling when stopped', async () => {
      const sent: ChannelStatus[] = [];
      const stop = startOutboxRelay(dir, (e) => sent.push(e), { pollMs: 20 });

      await new Promise((resolve) => setTimeout(resolve, 50));
      stop();
      stop();
      await writeJson(dir, 'a.json', statusEvent());
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(sent).toEqual([]);
    });
  });
});
