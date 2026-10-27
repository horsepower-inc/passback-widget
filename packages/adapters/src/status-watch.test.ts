import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parsePayload } from '@passback/schema';
import type { Payload } from '@passback/schema';
import { fromPayload, render } from '@passback/inbox';
import type { MarkStatus } from '@passback/inbox';
import { watchStatus } from './status-watch';

const POLL_MS = 20;
const CREATED_AT = '2026-09-19T14:00:00.000Z';

function firstPayload(): Payload {
  const dir = fileURLToPath(new URL('../../../fixtures/payloads/', import.meta.url));
  const file = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()[0]!;
  return parsePayload(JSON.parse(readFileSync(path.join(dir, file), 'utf8')));
}

const payload = firstPayload();

function textFor(status: MarkStatus): string {
  return render({
    ...fromPayload(payload, { id: 'm1', batchId: 'm1', createdAt: CREATED_AT }),
    status,
  });
}

describe('watchStatus', () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    vi.useFakeTimers();
    dir = mkdtempSync(path.join(os.tmpdir(), 'passback-status-watch-'));
    filePath = path.join(dir, 'm1.md');
    writeFileSync(filePath, textFor('new'));
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports a status change after one poll interval', async () => {
    const calls: string[] = [];
    const unsubscribe = watchStatus(filePath, POLL_MS, (s) => calls.push(s));
    writeFileSync(filePath, textFor('ack'));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(calls).toEqual(['ack']);
    unsubscribe();
  });

  it('reports a status written after an unparsable read that left the same mtime', async () => {
    const calls: string[] = [];
    const before = statSync(filePath);
    const unsubscribe = watchStatus(filePath, POLL_MS, (s) => calls.push(s));

    writeFileSync(filePath, 'not parseable');
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(calls).toEqual([]);

    writeFileSync(filePath, textFor('ack'));
    utimesSync(filePath, before.atime, before.mtime);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(calls).toEqual(['ack']);
    unsubscribe();
  });

  it('stays silent when the status is unchanged', async () => {
    const calls: string[] = [];
    const unsubscribe = watchStatus(filePath, POLL_MS, (s) => calls.push(s));
    writeFileSync(filePath, textFor('new'));
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(calls).toEqual([]);
    unsubscribe();
  });

  it('stays silent after unsubscribe and unsubscribe twice is safe', async () => {
    const calls: string[] = [];
    const unsubscribe = watchStatus(filePath, POLL_MS, (s) => calls.push(s));
    unsubscribe();
    writeFileSync(filePath, textFor('ack'));
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(calls).toEqual([]);
    expect(() => unsubscribe()).not.toThrow();
  });
});
