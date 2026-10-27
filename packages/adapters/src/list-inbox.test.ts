import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { markSentToTracker, render, type InboxFile } from '@passback/inbox';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listInbox } from './list-inbox';

let dir: string;
let inbox: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'pb-list-inbox-'));
  inbox = path.join(dir, 'inbox');
  await mkdir(inbox, { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function mark(id: string, over: Partial<InboxFile> = {}): InboxFile {
  return {
    id,
    schemaVersion: 1,
    batchId: 'B1',
    status: 'new',
    iteration: 1,
    route: '/home',
    selector: '#hero',
    createdAt: '2026-10-01T10:00:00.000Z',
    comment: `comment ${id}`,
    annotations: [],
    iterations: [],
    ...over,
  };
}

async function put(file: InboxFile): Promise<void> {
  await writeFile(path.join(inbox, `${file.id}.md`), render(file));
}

async function putPayload(id: string, body: string): Promise<void> {
  await mkdir(path.join(inbox, id), { recursive: true });
  await writeFile(path.join(inbox, id, 'payload.json'), body);
}

const element = (tag: string, text: string) => ({
  selectors: [{ kind: 'css', value: tag }],
  tag,
  attrs: {},
  text,
  outerHTML: `<${tag}></${tag}>`,
});

describe('listInbox', () => {
  it('lists one row per inbox file with the panel fields, newest first', async () => {
    await put(mark('A1', { createdAt: '2026-10-01T10:00:00.000Z' }));
    await put(mark('A3', { createdAt: '2026-10-03T10:00:00.000Z', status: 'ack', iteration: 2 }));
    await put(mark('A2', { createdAt: '2026-10-02T10:00:00.000Z' }));
    await put(mark('B2', { createdAt: '2026-10-02T10:00:00.000Z' }));
    const { items, truncated } = await listInbox(dir);
    expect(truncated).toBe(false);
    expect(items.map((r) => r.id)).toEqual(['A3', 'B2', 'A2', 'A1']);
    expect(items[0]).toMatchObject({
      id: 'A3',
      batchId: 'B1',
      status: 'ack',
      iteration: 2,
      route: '/home',
      selector: '#hero',
      comment: 'comment A3',
      createdAt: '2026-10-03T10:00:00.000Z',
    });
  });

  it('keeps the iterations with their statuses and the file, orphaned and parked fields', async () => {
    const iterations = [
      {
        n: 1,
        statuses: [{ state: 'running' as const, message: 'on it', at: '2026-10-01T10:01:00.000Z' }],
        agent: { at: '2026-10-01T10:02:00.000Z', text: 'done' },
        human: { at: '2026-10-01T10:03:00.000Z', verdict: { kind: 'accept' as const } },
      },
    ];
    await put(mark('R1', { iterations, file: 'src/App.tsx:3:4', orphaned: true, parked: true }));
    await put(mark('R2'));
    const { items } = await listInbox(dir);
    const full = items.find((r) => r.id === 'R1');
    expect(full?.iterations).toEqual(iterations);
    expect(full).toMatchObject({ file: 'src/App.tsx:3:4', orphaned: true, parked: true });
    const bare = items.find((r) => r.id === 'R2');
    expect(bare).not.toHaveProperty('parked');
    expect(bare).not.toHaveProperty('file');
    expect(bare).not.toHaveProperty('orphaned');
  });

  it('copies the sent-to-tracker field of a file onto its row and leaves it out when the file has none', async () => {
    const withUrl = { tracker: 'linear', ref: 'ISSUE-9', url: 'https://linear.app/x/ISSUE-9' };
    const noUrl = { tracker: 'jira', ref: 'K-1' };
    await put(markSentToTracker(mark('S1'), withUrl));
    await put(markSentToTracker(mark('S2'), noUrl));
    await put(mark('S3'));
    await put(mark('S4', { parked: true }));
    await put(markSentToTracker(mark('S5'), noUrl));
    const { items } = await listInbox(dir);
    const row = (id: string) => items.find((r) => r.id === id);
    expect(row('S1')?.sentToTracker).toEqual(withUrl);
    expect(row('S2')?.sentToTracker).toEqual(noUrl);
    expect(row('S2')?.sentToTracker).not.toHaveProperty('url');
    expect(row('S3')).not.toHaveProperty('sentToTracker');
    expect(row('S4')).toMatchObject({ parked: true });
    expect(row('S4')).not.toHaveProperty('sentToTracker');
    expect(row('S5')).not.toHaveProperty('parked');
    expect(row('S5')?.sentToTracker).toEqual(noUrl);
  });

  it('adds the target tag and text from payload.json and leaves it out when the payload is missing or invalid', async () => {
    await put(mark('T1', { createdAt: '2026-10-05T00:00:00.000Z' }));
    await put(mark('T2', { createdAt: '2026-10-04T00:00:00.000Z' }));
    await put(mark('T3', { createdAt: '2026-10-03T00:00:00.000Z' }));
    await put(mark('T4', { createdAt: '2026-10-02T00:00:00.000Z' }));
    await putPayload(
      'T1',
      JSON.stringify({ element: element('button', `  Save \n\t  all   ${'x'.repeat(100)}`) }),
    );
    await putPayload('T2', '{not json');
    await putPayload('T3', JSON.stringify({ element: { tag: 'p' } }));
    const { items } = await listInbox(dir);
    const t1 = items.find((r) => r.id === 'T1');
    expect(t1?.target?.tag).toBe('button');
    expect(t1?.target?.text.length).toBe(80);
    expect(t1?.target?.text.startsWith('Save all xxx')).toBe(true);
    for (const id of ['T2', 'T3', 'T4']) {
      const row = items.find((r) => r.id === id);
      expect(row).toBeDefined();
      expect(row).not.toHaveProperty('target');
    }
  });

  it('returns at most 200 rows newest first and reports truncated', async () => {
    for (let i = 0; i < 205; i += 1) {
      const id = `M${String(i).padStart(3, '0')}`;
      await put(mark(id, { createdAt: new Date(Date.UTC(2026, 9, 1) + i * 1000).toISOString() }));
    }
    const { items, truncated } = await listInbox(dir);
    expect(truncated).toBe(true);
    expect(items).toHaveLength(200);
    expect(items[0]?.id).toBe('M204');
    expect(items[199]?.id).toBe('M005');
  });

  it('skips an unparsable file, ignores folders and temporary files, and never throws', async () => {
    await put(mark('G1'));
    await writeFile(path.join(inbox, 'BAD.md'), 'not an inbox file');
    await writeFile(path.join(inbox, 'G2.md.123.tmp'), render(mark('G2')));
    await mkdir(path.join(inbox, 'G3.md'), { recursive: true });
    await mkdir(path.join(inbox, 'G4'), { recursive: true });
    const { items, truncated } = await listInbox(dir);
    expect(items.map((r) => r.id)).toEqual(['G1']);
    expect(truncated).toBe(false);
  });

  it('moves accepted comments older than 24 hours to done before listing them', async () => {
    const accepted = (id: string, at: string) =>
      mark(id, {
        status: 'accepted',
        iterations: [
          {
            n: 1,
            agent: { at: '2026-10-01T10:02:00.000Z', text: 'done' },
            human: { at, verdict: { kind: 'accept' } },
          },
        ],
      });
    await put(accepted('D1', '2026-10-01T12:00:00.000Z'));
    await put(accepted('D2', '2026-10-02T11:00:00.000Z'));
    const now = new Date('2026-10-02T12:00:00.000Z');
    const { items } = await listInbox(dir, now);
    expect(items.map((r) => r.id)).toEqual(['D2']);
    expect(await readdir(path.join(dir, 'done'))).toEqual(['D1.md']);
  });

  it('returns no rows for a missing inbox directory', async () => {
    expect(await listInbox(path.join(dir, 'nope'))).toEqual({ items: [], truncated: false });
  });
});
